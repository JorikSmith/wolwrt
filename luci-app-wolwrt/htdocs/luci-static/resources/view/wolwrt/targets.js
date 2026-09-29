'use strict';
'require view';
'require form';
'require rpc';
'require uci';
'require ui';
'require tools.widgets as widgets';
'require wolwrt';

var callClients = rpc.declare({ object: 'wolwrt', method: 'clients', expect: { clients: [] } });
var callWake = rpc.declare({ object: 'wolwrt', method: 'wake', params: [ 'target' ] });

var PRESETS = [
	'shutdown /s /t 0',
	'shutdown /h',
	'rundll32.exe powrprof.dll,SetSuspendState 0,1,0',
	'systemctl suspend',
	'systemctl hibernate',
	'systemctl poweroff'
];

return view.extend({
	load: function() {
		return Promise.all([
			L.resolveDefault(callClients(), []),
			uci.load('wolwrt')
		]);
	},

	render: function(data) {
		var clients = data[0], m, s, o;

		m = new form.Map('wolwrt');

		s = m.section(form.GridSection, 'target', _('Targets'));
		s.addremove = true;
		s.anonymous = false;
		s.nodescriptions = true;
		s.addbtntitle = _('Add target');
		s.modaltitle = function(section_id) {
			return _('Target: %s').format(uci.get('wolwrt', section_id, 'name') || section_id);
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
			    box = td.firstChild,
			    kind = wolwrt.offKind(section_id),
			    name = uci.get('wolwrt', section_id, 'name') || section_id;

			if (wolwrt.httpEnabled()) {
				var links = [ [ _('Wake'), { action: 'wake', target: section_id } ] ];
				if (kind)
					links.push([ wolwrt.offVerb(kind), { action: 'sleep', target: section_id } ]);
				if (uci.get('wolwrt', section_id, 'off_method') == 'winwarn')
					links.push([ _('Cancel shutdown'), { action: 'cancel', target: section_id } ]);
				box.insertBefore(E('button', {
					'class': 'btn',
					'click': function(ev) { ev.preventDefault(); wolwrt.showLinks(_('Links: %s').format(name), links); }
				}, _('Links')), box.firstChild);
			}

			box.insertBefore(E('button', {
				'class': 'btn cbi-button-positive',
				'click': ui.createHandlerFn(this, function() {
					return callWake(section_id).then(function(res) {
						ui.addNotification(null, E('p', {}, res.ok ? (res.message || _('Magic packet sent')) : res.message), res.ok ? 'info' : 'danger');
					});
				})
			}, _('Wake')), box.firstChild);

			return td;
		};

		o = s.option(form.Value, 'name', _('Name'));
		o.rmempty = false;
		o.placeholder = 'Desktop';

		o = s.option(form.Value, 'mac', _('MAC address'), _('Network card with Wake-on-LAN turned on in BIOS.'));
		o.rmempty = false;
		o.datatype = 'macaddr';
		clients.forEach(function(c) {
			o.value(c.mac, '%s (%s)'.format(c.host || c.ip, c.mac));
		});

		o = s.option(form.Value, 'ip', _('IP address'), _('Empty = take from DHCP lease by MAC. Used for online check and turning off.'));
		o.datatype = 'ip4addr';
		o.placeholder = _('from DHCP');
		clients.forEach(function(c) {
			if (c.ip)
				o.value(c.ip, '%s (%s)'.format(c.ip, c.host || c.mac));
		});

		o = s.option(widgets.NetworkSelect, 'network', _('Network'));
		o.modalonly = true;
		o.default = 'lan';
		o.nocreate = true;

		o = s.option(form.ListValue, 'off_method', _('Off method'));
		o.value('none', _('None, wake only'));
		o.value('ssh', _('SSH command'));
		o.value('winwarn', _('Windows shutdown with warning'));
		o.value('http', _('HTTP request'));
		o.value('sol', _('Sleep-on-LAN'));
		o.default = 'none';
		o.textvalue = function(section_id) {
			var v = this.cfgvalue(section_id) || 'none';
			return this.vallist[this.keylist.indexOf(v)] || v;
		};

		o = s.option(form.Value, 'ssh_cmd', _('Command'),
			_('Pick from list or type your own. Router key from Settings goes to authorized_keys on target.'));
		o.modalonly = true;
		o.depends('off_method', 'ssh');
		o.rmempty = false;
		PRESETS.forEach(function(cmd) { o.value(cmd, cmd); });

		o = s.option(form.Value, 'warn_delay', _('Warning, s'),
			_('Windows shows warning and shuts down after this delay. Cancel button appears on Status page.'));
		o.modalonly = true;
		o.depends('off_method', 'winwarn');
		o.datatype = 'range(10,3600)';
		o.placeholder = '60';

		o = s.option(form.Value, 'ssh_user', _('SSH user'));
		o.modalonly = true;
		o.depends('off_method', 'ssh');
		o.depends('off_method', 'winwarn');
		o.rmempty = false;

		o = s.option(form.Value, 'ssh_port', _('SSH port'));
		o.modalonly = true;
		o.depends('off_method', 'ssh');
		o.depends('off_method', 'winwarn');
		o.datatype = 'port';
		o.placeholder = '22';

		o = s.option(form.Value, 'idle_min', _('Keep on if used, min'),
			_('Rules leave Windows on when keyboard or mouse was used at console within this time. Needs Windows Pro or higher. Empty = check off.'));
		o.modalonly = true;
		o.depends('off_method', 'ssh');
		o.depends('off_method', 'winwarn');
		o.datatype = 'range(1,1440)';

		o = s.option(form.ListValue, 'http_method', _('Method'));
		o.modalonly = true;
		o.depends('off_method', 'http');
		o.value('GET');
		o.value('POST');

		o = s.option(form.Value, 'http_url', _('URL'));
		o.modalonly = true;
		o.depends('off_method', 'http');
		o.rmempty = false;
		o.validate = function(section_id, value) {
			return /^https?:\/\/\S+$/.test(value) ? true : _('Must start with http:// or https://');
		};

		o = s.option(form.Value, 'http_body', _('Body'), _('Sent with POST as form data.'));
		o.modalonly = true;
		o.depends('http_method', 'POST');

		o = s.option(form.Value, 'sol_port', _('Agent port'), _('Needs SleepOnLan agent on target. WOLwrt calls http://IP:port/sleep.'));
		o.modalonly = true;
		o.depends('off_method', 'sol');
		o.datatype = 'port';
		o.placeholder = '8009';

		return m.render().then(function(node) {
			return wolwrt.decorate(node, _('Computers that WOLwrt wakes with magic packet and turns off your way. ID goes into HTTP links.'));
		});
	}
});
