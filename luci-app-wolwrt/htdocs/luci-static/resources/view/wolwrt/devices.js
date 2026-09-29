'use strict';
'require view';
'require form';
'require rpc';
'require uci';
'require wolwrt';

var callStatus = rpc.declare({ object: 'wolwrt', method: 'status' });
var callClients = rpc.declare({ object: 'wolwrt', method: 'clients', expect: { clients: [] } });

return view.extend({
	load: function() {
		return Promise.all([
			L.resolveDefault(callStatus(), {}),
			L.resolveDefault(callClients(), []),
			uci.load('wolwrt')
		]);
	},

	render: function(data) {
		var st = data[0].devices || {}, clients = data[1], m, s, o;

		m = new form.Map('wolwrt');

		s = m.section(form.GridSection, 'device', _('Devices'));
		s.addremove = true;
		s.anonymous = true;
		s.nodescriptions = true;
		s.addbtntitle = _('Add device');
		s.modaltitle = function(section_id) {
			var name = uci.get('wolwrt', section_id, 'name');
			return name ? _('Device: %s').format(name) : _('New device');
		};

		o = s.option(form.Value, 'name', _('Name'));
		o.rmempty = false;
		o.placeholder = 'Anya iPhone';

		o = s.option(form.DynamicList, 'mac', _('MAC address'),
			_('Phone takes separate private MAC for each Wi-Fi network. If 2.4 and 5 GHz networks have different names, add MAC from both. MAC stays fixed while MAC rotation is off.'));
		o.rmempty = false;
		o.datatype = 'macaddr';
		o.textvalue = function(section_id) {
			return L.toArray(this.cfgvalue(section_id)).join(', ');
		};
		clients.forEach(function(c) {
			o.value(c.mac, '%s (%s)'.format(c.host || c.ip || c.mac, c.freq ? wolwrt.band(c.freq) : _('cable or other access point')));
		});

		o = s.option(form.DummyValue, '_detect', _('Tracking'));
		o.modalonly = false;
		o.textvalue = function(section_id) {
			var d = st[section_id];
			if (!d || !d.src)
				return '-';
			return d.src == 'hostapd' ? _('Wi-Fi events') : _('ARP check');
		};

		o = s.option(form.Value, 'away_timeout', _('Offline delay, s'),
			_('Empty = value from Settings.'));
		o.datatype = 'uinteger';
		o.placeholder = uci.get('wolwrt', 'main', 'away_timeout') || '300';
		o.textvalue = function(section_id) {
			var v = this.cfgvalue(section_id);
			return v ? _('%s s').format(v) : _('%s s (default)').format(this.placeholder);
		};

		return m.render().then(function(node) {
			return wolwrt.decorate(node, _('Phones that tell WOLwrt who is online. Connect phone to Wi-Fi and pick its MAC from list.'));
		});
	}
});
