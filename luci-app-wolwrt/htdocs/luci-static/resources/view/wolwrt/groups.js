'use strict';
'require view';
'require form';
'require uci';
'require wolwrt';

return view.extend({
	load: function() {
		return uci.load('wolwrt');
	},

	render: function() {
		var m, s, o;

		m = new form.Map('wolwrt');

		s = m.section(form.GridSection, 'group', _('Groups'));
		s.addremove = true;
		s.anonymous = true;
		s.nodescriptions = true;
		s.addbtntitle = _('Add group');
		s.modaltitle = function(section_id) {
			var name = uci.get('wolwrt', section_id, 'name');
			return name ? _('Group: %s').format(name) : _('New group');
		};

		o = s.option(form.Value, 'name', _('Name'));
		o.rmempty = false;
		o.placeholder = 'Team';

		o = s.option(form.MultiValue, 'member', _('Members'));
		o.rmempty = false;
		uci.sections('wolwrt', 'device').forEach(function(d) {
			o.value(d['.name'], d.name || L.toArray(d.mac).join(', '));
		});

		return m.render().then(function(node) {
			return wolwrt.decorate(node, _('Group is online while at least one member is online. Group rules fire when first member connects and last one disconnects.'));
		});
	}
});
