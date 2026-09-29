'use strict';
'require view';
'require form';
'require rpc';
'require uci';
'require ui';
'require wolwrt';

var callStatus = rpc.declare({ object: 'wolwrt', method: 'status' });
var callRun = rpc.declare({ object: 'wolwrt', method: 'run', params: [ 'rule' ] });

var DAYS = [
	[ 'mon', _('Mon') ], [ 'tue', _('Tue') ], [ 'wed', _('Wed') ], [ 'thu', _('Thu') ],
	[ 'fri', _('Fri') ], [ 'sat', _('Sat') ], [ 'sun', _('Sun') ]
];

var SOURCES = {
	first_arrive: 'group', last_leave: 'group',
	arrive: 'device', leave: 'device',
	target_online: 'target', target_offline: 'target'
};

function name(id) {
	return uci.get('wolwrt', id, 'name') || id;
}

function validTime(section_id, value) {
	return (!value || /^([01]\d|2[0-3]):[0-5]\d$/.test(value)) ? true : _('Use HH:MM, like 07:30');
}

function broken(id) {
	var kind = SOURCES[uci.get('wolwrt', id, 'trigger')],
	    act = uci.get('wolwrt', id, 'action');
	return (kind && !uci.get('wolwrt', uci.get('wolwrt', id, 'source'))) ||
		((act == 'wake' || act == 'sleep') && !uci.get('wolwrt', uci.get('wolwrt', id, 'target')));
}

function ruleState(id, st) {
	var from = uci.get('wolwrt', id, 'time_from'),
	    to = uci.get('wolwrt', id, 'time_to'),
	    days = L.toArray(uci.get('wolwrt', id, 'days')),
	    pause = (+uci.get('wolwrt', id, 'cooldown') || 0) * 60,
	    last = +((st.rules || {})[id] || {}).last || 0,
	    hm = st.hm, left;

	if (uci.get('wolwrt', id, 'enabled') == '0')
		return wolwrt.pill('off', _('turned off'));
	if (broken(id))
		return wolwrt.pill('bad', _('needs fix'));
	if (!hm)
		return '-';
	if (days.length && days.indexOf(st.day) < 0)
		return wolwrt.pill('off', _('not today'));
	if (from || to) {
		from = from || '00:00';
		to = to || '23:59';
		if (from > to ? (hm < from && hm > to) : (hm < from || hm > to))
			return wolwrt.pill('off', _('outside window'));
	}
	left = last + pause - st.ts;
	if (pause && last && left > 0)
		return wolwrt.pill('warn', _('pause, %d min left').format(Math.ceil(left / 60)));
	return wolwrt.pill('ok', _('ready'));
}

return view.extend({
	load: function() {
		return Promise.all([
			L.resolveDefault(callStatus(), {}),
			uci.load('wolwrt')
		]);
	},

	render: function(data) {
		var st = data[0], runs = st.rules || {}, m, s, o;

		m = new form.Map('wolwrt');

		s = m.section(form.GridSection, 'rule', _('Rules'));
		s.addremove = true;
		s.anonymous = false;
		s.sortable = true;
		s.nodescriptions = true;
		s.addbtntitle = _('Add rule');
		s.modaltitle = function(section_id) {
			return _('Rule: %s').format(name(section_id));
		};
		s.renderHeaderRows = function() {
			var rows = form.GridSection.prototype.renderHeaderRows.apply(this, arguments),
			    tr = rows.querySelector('tr.named');
			if (tr)
				tr.setAttribute('data-title', _('ID'));
			return rows;
		};
		s.renderRowActions = function(section_id) {
			var td = this.super('renderRowActions', [ section_id, _('Edit') ]),
			    box = td.firstChild;

			if (wolwrt.httpEnabled())
				box.insertBefore(E('button', {
					'class': 'btn',
					'click': function(ev) {
						ev.preventDefault();
						wolwrt.showLinks(_('Link: %s').format(name(section_id)), [ [ _('Run rule'), { action: 'run', rule: section_id } ] ]);
					}
				}, _('Link')), box.firstChild);

			box.insertBefore(E('button', {
				'class': 'btn cbi-button-action',
				'title': _('Run now, ignore days, time window and pause'),
				'disabled': broken(section_id) ? '' : null,
				'click': ui.createHandlerFn(this, function() {
					return callRun(section_id).then(function(res) {
						ui.addNotification(null, E('p', {}, res.ok ? _('Rule %s ran').format(name(section_id)) : res.message), res.ok ? 'info' : 'danger');
					});
				})
			}, _('Run')), box.firstChild);
			return td;
		};

		o = s.option(form.Flag, 'enabled', _('On'));
		o.default = '1';
		o.editable = true;

		o = s.option(form.Value, 'name', _('Name'));
		o.rmempty = false;
		o.placeholder = _('Phone connected: wake PC');

		o = s.option(form.ListValue, 'trigger', _('When'));
		o.value('first_arrive', _('First of group connects'));
		o.value('last_leave', _('Last of group disconnects'));
		o.value('arrive', _('Device connects'));
		o.value('leave', _('Device disconnects'));
		o.value('target_online', _('Target comes online'));
		o.value('target_offline', _('Target goes offline'));
		o.value('schedule', _('On schedule'));
		o.value('http', _('HTTP link'));
		o.textvalue = function(section_id) {
			var trig = uci.get('wolwrt', section_id, 'trigger'),
			    label = this.vallist[this.keylist.indexOf(trig)] || trig;
			if (trig == 'schedule')
				return '%s %s'.format(label, uci.get('wolwrt', section_id, 'at') || '');
			return SOURCES[trig] ? '%s: %s'.format(label, name(uci.get('wolwrt', section_id, 'source'))) : label;
		};

		[ [ 'group', _('Group') ], [ 'device', _('Device') ], [ 'target', _('Target') ] ].forEach(function(kind) {
			o = s.option(form.ListValue, '_src_' + kind[0], kind[1]);
			o.ucioption = 'source';
			o.modalonly = true;
			o.rmempty = false;
			o.remove = function() {};
			uci.sections('wolwrt', kind[0]).forEach(function(x) {
				o.value(x['.name'], x.name || x['.name']);
			});
			Object.keys(SOURCES).forEach(function(t) {
				if (SOURCES[t] == kind[0])
					o.depends('trigger', t);
			});
		});

		o = s.option(form.Value, 'at', _('Start time'));
		o.modalonly = true;
		o.depends('trigger', 'schedule');
		o.placeholder = _('HH:MM');
		o.rmempty = false;
		o.validate = validTime;

		o = s.option(form.ListValue, 'action', _('Do'));
		o.value('wake', _('Wake with magic packet'));
		o.value('sleep', _('Turn off with target method'));
		o.value('webhook', _('Call webhook'));
		o.value('notify', _('Send Telegram message'));
		o.textvalue = function(section_id) {
			var act = uci.get('wolwrt', section_id, 'action'),
			    tgt = uci.get('wolwrt', section_id, 'target');
			if (act == 'wake')
				return '%s: %s'.format(_('Wake'), name(tgt));
			if (act == 'sleep')
				return '%s: %s'.format(wolwrt.offVerb(wolwrt.offKind(tgt)), name(tgt));
			return this.vallist[this.keylist.indexOf(act)] || act;
		};

		o = s.option(form.ListValue, 'target', _('Target'),
			_('Turn off touches only targets that WOLwrt woke. Targets turned on by hand stay on.'));
		o.modalonly = true;
		o.depends('action', 'wake');
		o.depends('action', 'sleep');
		o.rmempty = false;
		uci.sections('wolwrt', 'target').forEach(function(x) {
			o.value(x['.name'], x.name || x['.name']);
		});

		o = s.option(form.Value, 'url', _('URL'));
		o.modalonly = true;
		o.depends('action', 'webhook');
		o.rmempty = false;
		o.placeholder = 'http://192.168.1.5:8123/api/webhook/pc_on';
		o.validate = function(section_id, value) {
			return /^https?:\/\/\S+$/.test(value) ? true : _('Must start with http:// or https://');
		};

		o = s.option(form.Value, 'message', _('Message'));
		o.modalonly = true;
		o.depends('action', 'notify');
		o.placeholder = _('PC is on');

		o = s.option(form.Value, 'time_from', _('Active from'),
			_('Empty from = since midnight, empty until = till end of day, both empty = all day. Windows over midnight like 22:00-06:00 work. Router time zone applies.'));
		o.modalonly = true;
		o.placeholder = _('HH:MM');
		o.validate = validTime;

		o = s.option(form.Value, 'time_to', _('Active until'));
		o.modalonly = true;
		o.placeholder = _('HH:MM');
		o.validate = validTime;

		o = s.option(form.MultiValue, 'days', _('Days'), _('Empty = every day.'));
		o.modalonly = true;
		DAYS.forEach(function(d) { o.value(d[0], d[1]); });

		o = s.option(form.Value, 'cooldown', _('Pause, min'), _('Rule does not fire again sooner than this.'));
		o.modalonly = true;
		o.datatype = 'uinteger';
		o.placeholder = '0';

		o = s.option(form.Flag, 'notify', _('Message on run'), _('Telegram message each time rule runs. Needs bot in Settings.'));
		o.modalonly = true;
		o.default = '1';
		o.depends('action', 'wake');
		o.depends('action', 'sleep');
		o.depends('action', 'webhook');

		o = s.option(form.DummyValue, '_cond', _('Conditions'));
		o.modalonly = false;
		o.textvalue = function(section_id) {
			var from = uci.get('wolwrt', section_id, 'time_from'),
			    to = uci.get('wolwrt', section_id, 'time_to'),
			    days = L.toArray(uci.get('wolwrt', section_id, 'days')),
			    pause = +uci.get('wolwrt', section_id, 'cooldown') || 0,
			    parts = [];
			parts.push((from || to) ? '%s-%s'.format(from || '00:00', to || '23:59') : _('all day'));
			parts.push(days.length ? days.map(function(d) {
				var x = DAYS.filter(function(y) { return y[0] == d; })[0];
				return x ? x[1] : d;
			}).join(', ') : _('every day'));
			if (pause)
				parts.push(_('pause %d min').format(pause));
			return parts.join(', ');
		};

		o = s.option(form.DummyValue, '_state', _('Now'));
		o.modalonly = false;
		o.textvalue = function(section_id) {
			return ruleState(section_id, st);
		};

		o = s.option(form.DummyValue, '_last', _('Last run'));
		o.modalonly = false;
		o.textvalue = function(section_id) {
			return runs[section_id] ? wolwrt.when(+runs[section_id].last) : _('never');
		};

		return m.render().then(function(node) {
			return wolwrt.decorate(node, _('What to do and when. Every matching rule runs. Turn off rules skip targets turned on by hand.'));
		});
	}
});
