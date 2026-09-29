'use strict';
'require view';
'require form';
'require rpc';
'require uci';
'require ui';
'require wolwrt';

var callPubkey = rpc.declare({ object: 'wolwrt', method: 'pubkey', expect: { pubkey: '' } });
var callCurl = rpc.declare({ object: 'wolwrt', method: 'curl' });
var callInstallCurl = rpc.declare({ object: 'wolwrt', method: 'install_curl' });
var callTgTest = rpc.declare({ object: 'wolwrt', method: 'tg_test' });

return view.extend({
	load: function() {
		return Promise.all([
			L.resolveDefault(callPubkey(), ''),
			L.resolveDefault(callCurl(), {}),
			uci.load('wolwrt'),
			uci.load('system')
		]);
	},

	render: function(data) {
		var pubkey = data[0], curl = data[1], m, s, o,
		    zone = uci.get_first('system', 'system', 'zonename') || 'UTC';

		m = new form.Map('wolwrt');

		s = m.section(form.NamedSection, 'main', 'wolwrt');
		s.tab('general', _('General'));
		s.tab('telegram', _('Telegram'));
		s.tab('http', _('HTTP links'));
		s.tab('proxy', _('Proxy'));
		s.tab('ssh', _('SSH key'));
		s.tab('updates', _('Updates'));

		o = s.taboption('general', form.Flag, 'enabled', _('Enable WOLwrt'));
		o.default = '1';
		o.rmempty = false;

		if (zone == 'UTC') {
			o = s.taboption('general', form.DummyValue, '_tz', _('Time zone'));
			o.rawhtml = true;
			o.default = '<span class="wolwrt-pill wolwrt-warn">UTC</span> ' +
				_('Rule time windows and schedules follow router clock. Set your time zone in System > System.');
		}

		o = s.taboption('general', form.Value, 'away_timeout', _('Offline delay, s'),
			_('How long device stays silent before it counts as offline. Phones drop Wi-Fi in sleep, so under 120 s gives false disconnects.'));
		o.datatype = 'min(10)';
		o.placeholder = '300';

		o = s.taboption('general', form.Value, 'poll_interval', _('Poll interval, s'),
			_('How often WOLwrt checks targets and devices outside this Wi-Fi.'));
		o.datatype = 'min(10)';
		o.placeholder = '30';

		o = s.taboption('general', form.Value, 'history_size', _('Log size'));
		o.datatype = 'range(10,1000)';
		o.placeholder = '100';

		o = s.taboption('telegram', form.Value, 'tg_token', _('Bot token'),
			_('Get it from @BotFather. Without token and chat ID messages are off.'));
		o.password = true;

		o = s.taboption('telegram', form.Value, 'tg_chat', _('Chat ID'));
		o.datatype = 'integer';

		o = s.taboption('telegram', form.Flag, 'notify_errors', _('Report errors'),
			_('Message when target does not wake, turn off fails or webhook fails.'));

		o = s.taboption('telegram', form.Button, '_tg_test', _('Check'));
		o.inputtitle = _('Send test message');
		o.inputstyle = 'action';
		o.onclick = function() {
			return callTgTest().then(function(res) {
				var text = res.ok ? _('Message sent. Save changes first if you edited fields.') :
					(res.message == 'setup' ? _('Set bot token and chat ID, then save.') : _('Sending failed. Check token, chat ID and proxy.'));
				ui.addNotification(null, E('p', {}, text), res.ok ? 'info' : 'danger');
			});
		};

		o = s.taboption('http', form.Flag, 'http_enabled', _('Enable'),
			_('Links for iOS Shortcuts, Tasker or Home Assistant. Work in local network only. Anyone with token can wake and turn off targets.'));

		o = s.taboption('http', form.Value, 'http_token', _('Token'));
		o.depends('http_enabled', '1');
		o.rmempty = false;
		o.datatype = 'and(minlength(12),hexstring)';
		o.renderWidget = function(section_id, option_index, cfgvalue) {
			var widget = form.Value.prototype.renderWidget.apply(this, [ section_id, option_index, cfgvalue ]),
			    self = this;
			return E('div', { 'style': 'display:flex;gap:8px;flex-wrap:wrap' }, [
				widget,
				E('button', { 'class': 'btn', 'click': function(ev) {
					ev.preventDefault();
					var b = new Uint8Array(8);
					window.crypto.getRandomValues(b);
					self.getUIElement(section_id).setValue(Array.prototype.map.call(b, function(x) { return ('0' + x.toString(16)).slice(-2); }).join(''));
				} }, _('Generate'))
			]);
		};

		o = s.taboption('http', form.DummyValue, '_http_hint', _('Links'));
		o.depends('http_enabled', '1');
		o.default = _('Ready links sit behind Links buttons on Targets and Rules pages. Save token first.');

		o = s.taboption('proxy', form.Value, 'proxy', _('SOCKS proxy'),
			_('For Telegram and update checks where they are blocked. Format socks5://user:pass@host:1080 or socks4://host:1080.'));
		o.placeholder = 'socks5://user:pass@host:1080';
		o.validate = function(section_id, value) {
			return (!value || /^socks[45]:\/\/\S+:\d+$/.test(value)) ? true : _('Use socks5://user:pass@host:port or socks4://host:port');
		};

		o = s.taboption('proxy', form.DummyValue, '_curl', 'curl');
		o.render = function() {
			var field = E('div', { 'class': 'cbi-value-field' }),
			    desc = E('div', { 'class': 'cbi-value-description' }, _('Proxy works through curl, about 530 KB with libraries. It is installed only by this button.'));

			var show = function(st) {
				if (st.installed)
					return field.replaceChildren(wolwrt.pill('ok', _('installed')));
				if (st.installing) {
					field.replaceChildren(wolwrt.pill('warn', _('installing')), desc);
					return window.setTimeout(function() { L.resolveDefault(callCurl(), {}).then(show); }, 2000);
				}
				field.replaceChildren(wolwrt.pill('warn', _('not installed')), ' ',
					E('button', { 'class': 'btn cbi-button-action', 'click': ui.createHandlerFn(this, function() {
						return callInstallCurl().then(function() { show({ installing: true }); });
					}) }, _('Install curl')),
					st.error ? E('pre', { 'class': 'alert-message warning' }, _('Install failed:') + '\n' + st.error) : '',
					desc);
			};

			show(curl);
			return E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title' }, 'curl'), field ]);
		};

		o = s.taboption('ssh', form.DummyValue, '_pubkey', _('Router public key'),
			_('Needed to turn targets off over SSH. Add it to ~/.ssh/authorized_keys on target. For Windows admin account use C:\\ProgramData\\ssh\\administrators_authorized_keys.'));
		o.render = function() {
			return E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, this.title),
				E('div', { 'class': 'cbi-value-field' }, [
					E('textarea', { 'readonly': '', 'rows': 3, 'style': 'width:100%;font-family:monospace;font-size:12px' }, pubkey),
					E('button', { 'class': 'btn', 'click': function(ev) { ev.preventDefault(); wolwrt.copy(pubkey); } }, _('Copy')),
					E('div', { 'class': 'cbi-value-description' }, this.description)
				])
			]);
		};

		o = s.taboption('updates', form.Flag, 'update_auto', _('Check daily'),
			_('Looks for new release on GitHub. Install starts only by your click.'));
		o.default = '1';
		o.rmempty = false;

		o = s.taboption('updates', form.Button, '_update', _('Updates'));
		o.inputtitle = _('Open update window');
		o.onclick = function() {
			document.querySelector('.wolwrt-ver').click();
		};

		return m.render().then(function(node) {
			return wolwrt.decorate(node, _('Timing, notifications, remote access and updates.'));
		});
	}
});
