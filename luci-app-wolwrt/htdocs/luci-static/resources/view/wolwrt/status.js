'use strict';
'require view';
'require poll';
'require rpc';
'require uci';
'require ui';
'require wolwrt';

var callStatus = rpc.declare({ object: 'wolwrt', method: 'status' });
var callHistory = rpc.declare({ object: 'wolwrt', method: 'history', params: [ 'n' ] });
var callWake = rpc.declare({ object: 'wolwrt', method: 'wake', params: [ 'target' ] });
var callSleep = rpc.declare({ object: 'wolwrt', method: 'sleep', params: [ 'target' ] });
var callCancel = rpc.declare({ object: 'wolwrt', method: 'cancel', params: [ 'target' ] });

var EVENTS = {
	arrive: _('Connected'),
	leave: _('Disconnected'),
	first_arrive: _('First one connected'),
	last_leave: _('Everyone offline'),
	wake: _('Magic packet'),
	wake_retry: _('Wake again'),
	wake_failed: _('Wake failed'),
	sleep_failed: _('Turn off failed'),
	sleep_skipped: _('Left on'),
	off_cancelled: _('Shutdown cancelled'),
	target_online: _('Online'),
	target_offline: _('Offline'),
	no_response: _('No response'),
	rule: _('Rule ran'),
	rule_skipped: _('Rule skipped'),
	webhook: _('Webhook'),
	webhook_failed: _('Webhook failed'),
	notify: _('Telegram'),
	notify_failed: _('Telegram failed'),
	update: _('Updated')
};

var DETAILS = {
	rule_skipped: { days: _('not today'), window: _('outside time window'), pause: _('pause not over') },
	sleep_skipped: { manual: _('turned on by hand'), off: _('already off'), active: _('someone is using it') },
	notify_failed: { setup: _('bot not set up') },
	target_online: { wolwrt: _('by WOLwrt'), manual: _('by hand') },
	off_cancelled: { target: _('on computer') }
};

var METHODS = {
	none: _('None, wake only'),
	ssh: _('SSH command'),
	winwarn: _('Windows shutdown with warning'),
	http: _('HTTP request'),
	sol: _('Sleep-on-LAN')
};

function table(heads, rows, empty) {
	var t = E('table', { 'class': 'table' }, E('tr', { 'class': 'tr table-titles' },
		heads.map(function(h) { return E('th', { 'class': 'th' }, h); })));

	rows.forEach(function(r) {
		t.appendChild(E('tr', { 'class': 'tr' }, r.map(function(c, i) {
			return E('td', { 'class': 'td', 'data-title': heads[i] }, c);
		})));
	});

	if (!rows.length)
		t.appendChild(E('tr', { 'class': 'tr placeholder' }, E('td', { 'class': 'td' }, E('em', {}, empty))));

	return t;
}

function uciName(id) {
	var s = uci.get('wolwrt', id);
	return (s && s.name) || id;
}

function eventDetail(e) {
	var d = e.detail || '', p;
	if (e.event == 'rule') {
		p = d.split(' ');
		return [ {
			wake: _('Wake'),
			sleep: wolwrt.offVerb(wolwrt.offKind(p[1])),
			webhook: _('Webhook'),
			notify: _('Telegram')
		}[p[0]] || p[0], p[1] ? uciName(p[1]) : '' ].filter(Boolean).join(' ');
	}
	if (e.event == 'arrive')
		return d.replace(/^hostapd/, 'Wi-Fi').replace(/^arp/, 'ARP');
	if (e.event == 'wake_retry')
		return _('try %s').format(d);
	return (DETAILS[e.event] || {})[d] || d;
}

return view.extend({
	load: function() {
		return Promise.all([
			L.resolveDefault(callStatus(), {}),
			L.resolveDefault(callHistory(10), { events: [] }),
			uci.load('wolwrt')
		]);
	},

	renderSummary: function(st) {
		var devs = Object.values(st.devices || {}),
		    tgts = Object.values(st.targets || {}),
		    online = devs.filter(function(d) { return d.state == 'online' || d.state == 'leaving'; }).length,
		    on = tgts.filter(function(t) { return t.online; }).length;

		return E('div', { 'class': 'wolwrt-sum' }, [
			E('div', {}, [ E('small', {}, _('Devices online')), E('b', {}, _('%d of %d').format(online, devs.length)) ]),
			E('div', {}, [ E('small', {}, _('Targets on')), E('b', {}, _('%d of %d').format(on, tgts.length)) ])
		]);
	},

	renderGroups: function(st) {
		var devs = st.devices || {};

		return table([ _('Group'), _('Now'), _('Members') ], Object.keys(st.groups || {}).map(function(id) {
			var g = st.groups[id];
			return [
				E('strong', {}, g.name),
				g.online > 0 ? wolwrt.pill('ok', _('%d of %d online').format(g.online, g.members.length)) : wolwrt.pill('off', _('nobody online')),
				E('div', { 'class': 'wolwrt-chips' }, g.members.map(function(m) {
					return E('span', { 'class': 'wolwrt-chip' }, devs[m] ? devs[m].name : m);
				}))
			];
		}), _('No groups yet'));
	},

	renderDevices: function(st) {
		var now = st.ts || Date.now() / 1000;

		return table([ _('Device'), _('State'), _('Connection'), _('Signal'), _('Activity') ], Object.keys(st.devices || {}).map(function(id) {
			var d = st.devices[id], away = d.state == 'away', state;

			if (d.state == 'online')
				state = wolwrt.pill('ok', _('online'));
			else if (d.state == 'leaving')
				state = wolwrt.pill('warn', _('offline in %d s').format(Math.max(0, +d.seen + +d.timeout - now)));
			else
				state = wolwrt.pill('off', _('offline'));

			return [
				E('div', {}, [ d.name, E('div', { 'class': 'wolwrt-note' }, (d.mac || '').split(' ').join(', ')) ]),
				state,
				(d.src && !away) ? E('div', {}, [
					[ d.iface, wolwrt.band(d.freq) ].filter(Boolean).join(', '),
					E('div', { 'class': 'wolwrt-note' }, d.src == 'hostapd' ? _('Wi-Fi event') : _('ARP check'))
				]) : '-',
				(d.signal && !away) ? '%s dBm'.format(d.signal) : '-',
				away ? (d.seen ? _('seen %s').format(wolwrt.ago(+d.seen)) : _('not seen yet')) : _('since %s').format(wolwrt.when(+d.since))
			];
		}), _('No devices yet'));
	},

	renderTargets: function(st) {
		var now = st.ts || Date.now() / 1000;

		return table([ _('Target'), _('State'), _('Turned on by'), _('Off method'), '' ], Object.keys(st.targets || {}).map(function(id) {
			var t = st.targets[id],
			    method = uci.get('wolwrt', id, 'off_method') || 'none',
			    kind = wolwrt.offKind(id),
			    state, buttons;

			if (t.off_at)
				state = wolwrt.pill('warn', _('off in %d s').format(Math.max(0, t.off_at - now)));
			else
				state = t.online ? wolwrt.pill('ok', _('online')) : wolwrt.pill('off', _('offline'));

			buttons = [
				E('button', {
					'class': 'btn cbi-button-positive',
					'disabled': t.online ? '' : null,
					'click': ui.createHandlerFn(this, 'handleCall', callWake, id)
				}, _('Wake'))
			];

			if (t.off_at)
				buttons.push(' ', E('button', {
					'class': 'btn cbi-button-action',
					'click': ui.createHandlerFn(this, 'handleCall', callCancel, id)
				}, _('Cancel shutdown')));
			else if (kind)
				buttons.push(' ', E('button', {
					'class': 'btn cbi-button-negative',
					'disabled': t.online ? null : '',
					'click': ui.createHandlerFn(this, 'handleOff', id, t.name, kind)
				}, wolwrt.offVerb(kind)));

			return [
				E('div', {}, [ t.name, E('div', { 'class': 'wolwrt-note' }, t.ip || _('no IP address')) ]),
				E('div', {}, [ state, E('div', { 'class': 'wolwrt-note' }, _('since %s').format(wolwrt.when(+t.since))) ]),
				t.online ? E('div', {}, [
					t.woken_by == 'wolwrt' ? 'WOLwrt' : _('by hand'),
					E('div', { 'class': 'wolwrt-note' }, t.woken_by == 'wolwrt' ? _('rules may turn it off') : _('rules leave it on'))
				]) : '-',
				METHODS[method],
				E('div', { 'class': 'right' }, buttons)
			];
		}, this), _('No targets yet'));
	},

	renderLog: function(events) {
		return table([ _('Time'), _('Event'), _('Details') ], events.slice().reverse().map(function(e) {
			var kind = { ok: 'ok', warn: 'warn', bad: 'bad' }[e.kind] || 'off',
			    label = e.event == 'sleep' ? wolwrt.offDone(wolwrt.offKind(e.id)) : (EVENTS[e.event] || e.event);
			return [ wolwrt.when(e.ts), wolwrt.pill(kind, label), [ uciName(e.id), eventDetail(e) ].filter(Boolean).join(': ') ];
		}), _('Nothing happened yet'));
	},

	handleCall: function(fn, id) {
		return fn(id).then(function(res) {
			if (!res.ok)
				ui.addNotification(null, E('p', {}, res.message || _('Failed')), 'danger');
		});
	},

	handleOff: function(id, name, kind) {
		ui.showModal('%s: %s'.format(wolwrt.offVerb(kind), name), [
			E('p', {}, _('Off method of this target runs now.')),
			E('div', { 'class': 'right' }, [
				E('button', { 'class': 'btn', 'click': ui.hideModal }, _('Cancel')), ' ',
				E('button', { 'class': 'btn cbi-button-negative', 'click': ui.createHandlerFn(this, function() {
					ui.hideModal();
					return this.handleCall(callSleep, id);
				}) }, wolwrt.offVerb(kind))
			])
		]);
	},

	update: function(st, history) {
		var box = document.getElementById('wolwrt-status');

		if (!box)
			return;

		if (st.error) {
			box.replaceChildren(E('div', { 'class': 'alert-message warning' },
				_('wolwrtd is not running. Turn it on in Settings and press Save & Apply.')));
			return;
		}

		box.replaceChildren(
			this.renderSummary(st),
			E('h3', {}, _('Groups')), this.renderGroups(st),
			E('h3', {}, _('Devices')), this.renderDevices(st),
			E('h3', {}, _('Targets')), this.renderTargets(st),
			E('h3', {}, _('Log')), this.renderLog(history.events || [])
		);
	},

	render: function(data) {
		var node = E('div', {}, [
			wolwrt.header(_('Who is online, what is on and what WOLwrt did lately.')),
			E('div', { 'id': 'wolwrt-status' }),
			wolwrt.footer()
		]);

		poll.add(L.bind(function() {
			return Promise.all([
				L.resolveDefault(callStatus(), {}),
				L.resolveDefault(callHistory(10), { events: [] })
			]).then(L.bind(function(res) { this.update(res[0], res[1]); }, this));
		}, this), 5);

		window.setTimeout(L.bind(this.update, this, data[0], data[1]), 0);
		return node;
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
