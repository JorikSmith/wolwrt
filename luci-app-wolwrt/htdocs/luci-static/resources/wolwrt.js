'use strict';
'require baseclass';
'require fs';
'require poll';
'require rpc';
'require uci';
'require ui';

var GITHUB = 'https://github.com/JorikSmith';
var REPO = GITHUB + '/wolwrt';

var css = '\
.wolwrt-head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}\
.wolwrt-head h2{margin:0}\
.wolwrt-ver{display:inline-flex;border:1px solid #b3bbc5;border-radius:4px;overflow:hidden;padding:0;background:transparent;color:inherit;cursor:pointer;font-size:12.5px;font-weight:600;min-height:28px}\
.wolwrt-ver span{display:flex;align-items:center;padding:0 10px}\
.wolwrt-ver .cur{font-family:monospace;font-weight:500}\
.wolwrt-ver.upd{border-color:#0062c8}\
.wolwrt-ver.upd .new{background:#0062c8;color:#fff}\
.wolwrt-pill{display:inline-block;padding:1px 8px;border-radius:3px;font-size:12px;font-weight:600;white-space:nowrap}\
.wolwrt-ok{background:#e1f2e4;color:#23703a}\
.wolwrt-warn{background:#fff0d2;color:#8a5200}\
.wolwrt-bad{background:#fbe3e1;color:#ae2d26}\
.wolwrt-off{background:#eceef1;color:#5b6570}\
:root[data-darkmode="true"] .wolwrt-ok{background:#1c3322;color:#72cd81}\
:root[data-darkmode="true"] .wolwrt-warn{background:#3a2d14;color:#eaae50}\
:root[data-darkmode="true"] .wolwrt-bad{background:#3e2120;color:#f2776f}\
:root[data-darkmode="true"] .wolwrt-off{background:#2e3339;color:#a4adb7}\
.wolwrt-note{font-size:12.5px;opacity:.75}\
.wolwrt-sum{display:flex;flex-wrap:wrap;border:1px solid #d9dde3;border-radius:4px;margin:12px 0}\
.wolwrt-sum>div{flex:1 1 200px;padding:10px 14px}\
.wolwrt-sum>div+div{border-left:1px solid #d9dde3}\
.wolwrt-sum small{display:block;opacity:.75;font-size:12.5px}\
.wolwrt-sum b{font-size:15px}\
.wolwrt-chips{display:flex;flex-wrap:wrap;gap:5px}\
.wolwrt-chip{font-size:12.5px;padding:1px 9px;border:1px solid #d9dde3;border-radius:10px}\
.wolwrt-foot{margin-top:24px;padding-top:10px;border-top:1px solid #d9dde3;font-size:12.5px;opacity:.8}\
.wolwrt-steps{list-style:none;padding:0;margin:8px 0;display:flex;flex-direction:column;gap:6px}\
.wolwrt-steps li{display:flex;justify-content:space-between;gap:12px;padding:6px 10px;border:1px solid #d9dde3;border-radius:4px}\
.wolwrt-notes{white-space:pre-wrap;max-height:40vh;overflow:auto;border:1px solid #d9dde3;border-radius:4px;padding:8px 10px;font-size:13px}\
.wolwrt-link{display:flex;gap:8px;align-items:center;margin:6px 0}\
.wolwrt-link code{flex:1;overflow-x:auto;white-space:nowrap;padding:4px 6px}\
@media (max-width:760px){.wolwrt-sum>div+div{border-left:0;border-top:1px solid #d9dde3}}';

var callUpdateInfo = rpc.declare({ object: 'wolwrt', method: 'update_info' });
var callUpdateCheck = rpc.declare({ object: 'wolwrt', method: 'update_check' });
var callUpdateInstall = rpc.declare({ object: 'wolwrt', method: 'update_install' });

function when(ts) {
	if (!ts)
		return _('never');
	var d = new Date(ts * 1000), now = new Date(),
	    hm = '%02d:%02d'.format(d.getHours(), d.getMinutes()),
	    days = Math.floor((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000);
	if (days == 0)
		return _('today %s').format(hm);
	if (days == 1)
		return _('yesterday %s').format(hm);
	return '%02d.%02d.%04d %s'.format(d.getDate(), d.getMonth() + 1, d.getFullYear(), hm);
}

function ago(ts) {
	var m = Math.floor((Date.now() / 1000 - ts) / 60);
	if (m < 1)
		return _('just now');
	if (m < 60)
		return _('%d min ago').format(m);
	if (m < 1440)
		return _('%d h %d min ago').format(Math.floor(m / 60), m % 60);
	return _('%d d ago').format(Math.floor(m / 1440));
}

function copyText(text) {
	return navigator.clipboard.writeText(text).then(function() {
		ui.addTimeLimitedNotification(null, E('p', {}, _('Copied')), 3000, 'info');
	}, function() {
		ui.addNotification(null, E('p', {}, _('Copy failed, select text by hand')), 'warning');
	});
}

var steps = [
	[ 'download', _('Download packages') ],
	[ 'verify', _('Check checksums') ],
	[ 'install', _('Install') ],
	[ 'restart', _('Restart wolwrtd') ]
];

function showProgress(latest) {
	var list = E('ul', { 'class': 'wolwrt-steps' }),
	    msg = E('p', {}, _('Updating. Keep this page open.')),
	    foot = E('div', { 'class': 'right' });

	poll.stop();
	ui.showModal(_('Update WOLwrt'), [ list, msg, foot ]);

	var tick = function() {
		return L.resolveDefault(fs.read('/var/run/wolwrt/update.json'), '').then(function(raw) {
			var st;
			try {
				st = JSON.parse(raw);
			}
			catch (e) {
				return window.setTimeout(tick, 1500);
			}
			var phase = st.phase || 'download',
			    idx = steps.findIndex(function(s) { return s[0] == phase; });

			list.innerHTML = '';
			steps.forEach(function(s, i) {
				var cls = (phase == 'done' || i < idx) ? 'ok' : (i == idx ? 'warn' : 'off'),
				    label = cls == 'ok' ? _('done') : (cls == 'warn' ? (phase == 'failed' ? _('failed') : _('in progress')) : _('waiting'));
				list.appendChild(E('li', {}, [ E('span', {}, s[1]), E('span', { 'class': 'wolwrt-pill wolwrt-' + cls }, label) ]));
			});

			if (phase == 'done') {
				msg.textContent = _('Updated to %s. Reload page to get new interface.').format(st.message || latest);
				foot.appendChild(E('button', { 'class': 'btn cbi-button-action', 'click': reloadFresh }, _('Reload page')));
				return;
			}
			if (phase == 'failed') {
				msg.textContent = _('Update failed: %s').format(st.message || '');
				foot.appendChild(E('button', { 'class': 'btn', 'click': function() { ui.hideModal(); poll.start(); } }, _('Close')));
				return;
			}
			window.setTimeout(tick, 1500);
		});
	};

	window.setTimeout(tick, 1000);
}

function waitCheck() {
	return new Promise(function(resolve) {
		var poll = function() {
			L.resolveDefault(callUpdateInfo(), {}).then(function(info) {
				if (info.checking)
					window.setTimeout(poll, 2000);
				else
					resolve(info);
			});
		};
		window.setTimeout(poll, 1500);
	});
}

function showUpdate(info) {
	var body = [];

	if (info.error)
		body.push(E('p', { 'class': 'alert-message warning' }, _('Check failed: %s. If GitHub is blocked where you live, set proxy in Settings.').format(info.error)));

	if (info.available) {
		body.push(E('table', { 'class': 'table' }, [
			E('tr', { 'class': 'tr' }, [ E('td', { 'class': 'td left' }, _('Installed')), E('td', { 'class': 'td left' }, E('code', {}, info.current)) ]),
			E('tr', { 'class': 'tr' }, [ E('td', { 'class': 'td left' }, _('Latest')), E('td', { 'class': 'td left' }, [ E('code', {}, info.latest), ' ', E('span', { 'class': 'wolwrt-note' }, (info.published || '').substr(0, 10)) ]) ])
		]));
		if (info.notes) {
			body.push(E('h5', {}, _('Changes')));
			body.push(E('div', { 'class': 'wolwrt-notes' }, info.notes));
		}
		body.push(E('p', { 'class': 'wolwrt-note' }, _('Settings in /etc/config/wolwrt stay. wolwrtd restarts, rules pause briefly.')));
	}
	else if (info.latest) {
		body.push(E('p', {}, _('Version %s is latest. Checked %s.').format(info.current, when(info.checked))));
	}
	else if (!info.error) {
		body.push(E('p', {}, _('Installed version %s, no check yet.').format(info.current)));
	}

	var check = E('button', { 'class': 'btn', 'click': ui.createHandlerFn(this, function() {
		return callUpdateCheck().then(waitCheck).then(showUpdate);
	}) }, _('Check now'));

	var buttons = [ E('button', { 'class': 'btn', 'click': ui.hideModal }, _('Close')), ' ', check ];

	if (info.available) {
		buttons.unshift(E('a', { 'class': 'btn', 'href': info.url || (REPO + '/releases'), 'target': '_blank', 'rel': 'noopener' }, _('Release page')), ' ');
		buttons.push(' ', E('button', { 'class': 'btn cbi-button-action', 'click': function() {
			callUpdateInstall().then(function() { showProgress(info.latest); });
		} }, _('Update to %s').format(info.latest)));
	}

	body.push(E('div', { 'class': 'right' }, buttons));
	ui.showModal(info.available ? _('Update available') : _('WOLwrt updates'), body);
}

function reloadFresh() {
	var v = L.env.resource_version ? '?v=' + L.env.resource_version : '';
	Promise.all([ 'wolwrt', 'view/wolwrt/status', 'view/wolwrt/devices', 'view/wolwrt/groups', 'view/wolwrt/targets', 'view/wolwrt/rules', 'view/wolwrt/settings' ].map(function(f) {
		return fetch(L.env.base_url + '/' + f + '.js' + v, { cache: 'reload' }).catch(function() {});
	})).then(function() { location.reload(); });
}

function staleCode(build) {
	var old;
	try {
		old = localStorage.getItem('wolwrt-build');
		localStorage.setItem('wolwrt-build', build);
	}
	catch (e) {
		return false;
	}
	return !!old && old != build;
}

function offKind(id) {
	var method = uci.get('wolwrt', id, 'off_method') || 'none';
	if (method == 'none')
		return null;
	if (method == 'winwarn')
		return 'shutdown';
	if (method == 'sol')
		return 'sleep';
	var cmd = method == 'ssh' ? (uci.get('wolwrt', id, 'ssh_cmd') || '').toLowerCase() : '';
	if (/hibernat|shutdown(\.exe)?\s+\/h/.test(cmd))
		return 'hibernate';
	if (/suspend|sleep/.test(cmd))
		return 'sleep';
	if (/shutdown|poweroff|halt|init 0/.test(cmd))
		return 'shutdown';
	return 'off';
}

function httpLink(params) {
	var q = [ 'token=' + (uci.get('wolwrt', 'main', 'http_token') || '') ];
	for (var k in params)
		q.push(k + '=' + params[k]);
	return '%s//%s/cgi-bin/wolwrt?%s'.format(window.location.protocol, window.location.host, q.join('&'));
}

return baseclass.extend({
	when: when,
	ago: ago,
	copy: copyText,
	offKind: offKind,

	band: function(freq) {
		if (!freq)
			return '';
		return +freq > 5900 ? _('6 GHz') : +freq > 3000 ? _('5 GHz') : _('2.4 GHz');
	},

	offVerb: function(kind) {
		return { sleep: _('Sleep'), hibernate: _('Hibernate'), shutdown: _('Shut down') }[kind] || _('Turn off');
	},

	offDone: function(kind) {
		return { sleep: _('Went to sleep'), hibernate: _('Hibernated'), shutdown: _('Powered off') }[kind] || _('Turned off');
	},

	pill: function(kind, text) {
		return E('span', { 'class': 'wolwrt-pill wolwrt-' + kind }, text);
	},

	httpEnabled: function() {
		return uci.get('wolwrt', 'main', 'http_enabled') == '1' && !!uci.get('wolwrt', 'main', 'http_token');
	},

	showLinks: function(title, links) {
		ui.showModal(title, [
			E('p', { 'class': 'wolwrt-note' }, _('Open link from phone in local network. For iOS Shortcuts use action Get contents of URL.')),
			links.map(function(l) {
				var url = httpLink(l[1]);
				return E('div', {}, [
					E('strong', {}, l[0]),
					E('div', { 'class': 'wolwrt-link' }, [
						E('code', {}, url),
						E('button', { 'class': 'btn', 'click': function() { copyText(url); } }, _('Copy'))
					])
				]);
			}),
			E('div', { 'class': 'right' }, E('button', { 'class': 'btn', 'click': ui.hideModal }, _('Close')))
		]);
	},

	header: function(description) {
		var btn = E('button', { 'class': 'wolwrt-ver', 'click': function() {
			L.resolveDefault(callUpdateInfo(), {}).then(showUpdate);
		} }, E('span', { 'class': 'cur' }, 'v…'));

		L.resolveDefault(callUpdateInfo(), {}).then(function(info) {
			if (info.build && staleCode(info.build))
				return reloadFresh();
			btn.innerHTML = '';
			btn.appendChild(E('span', { 'class': 'cur' }, 'v' + (info.current || '?')));
			if (info.available) {
				btn.classList.add('upd');
				btn.appendChild(E('span', { 'class': 'new' }, _('%s available').format(info.latest)));
				btn.setAttribute('aria-label', _('WOLwrt %s, update %s available').format(info.current, info.latest));
			}
		});

		return E('div', {}, [
			E('style', {}, css),
			E('div', { 'class': 'wolwrt-head' }, [ E('h2', {}, 'WOLwrt'), btn ]),
			description ? E('div', { 'class': 'cbi-map-descr' }, description) : ''
		]);
	},

	footer: function() {
		return E('div', { 'class': 'wolwrt-foot' }, [
			_('WOLwrt by'), ' ',
			E('a', { 'href': GITHUB, 'target': '_blank', 'rel': 'noopener' }, 'JorikSmith')
		]);
	},

	decorate: function(node, description) {
		node.insertBefore(this.header(description), node.firstChild);
		node.appendChild(this.footer());
		return node;
	}
});
