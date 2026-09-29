include $(TOPDIR)/rules.mk

PKG_NAME:=wolwrt
PKG_VERSION:=0.1.0
PKG_RELEASE:=1
PKG_MAINTAINER:=JorikSmith
PKG_LICENSE:=MIT

include $(INCLUDE_DIR)/package.mk

define Package/wolwrt
  SECTION:=net
  CATEGORY:=Network
  TITLE:=Wake and sleep LAN devices by phone presence
  URL:=https://github.com/JorikSmith/wolwrt
  DEPENDS:=+etherwake
  PKGARCH:=all
endef

define Package/wolwrt/conffiles
/etc/config/wolwrt
/etc/wolwrt/
endef

define Build/Compile
endef

define Package/wolwrt/install
	$(INSTALL_DIR) $(1)/etc/config $(1)/etc/init.d $(1)/usr/sbin $(1)/usr/lib/wolwrt \
		$(1)/usr/libexec/rpcd $(1)/usr/share/wolwrt $(1)/www/cgi-bin
	$(INSTALL_CONF) ./files/etc/config/wolwrt $(1)/etc/config/wolwrt
	$(INSTALL_BIN) ./files/etc/init.d/wolwrt $(1)/etc/init.d/wolwrt
	$(INSTALL_BIN) ./files/usr/sbin/wolwrt $(1)/usr/sbin/wolwrt
	$(INSTALL_BIN) ./files/usr/sbin/wolwrtd $(1)/usr/sbin/wolwrtd
	$(INSTALL_DATA) ./files/usr/lib/wolwrt/common.sh $(1)/usr/lib/wolwrt/common.sh
	echo "$(PKG_VERSION)" > $(1)/usr/lib/wolwrt/version
	$(INSTALL_BIN) ./files/usr/libexec/rpcd/wolwrt $(1)/usr/libexec/rpcd/wolwrt
	$(INSTALL_BIN) ./files/www/cgi-bin/wolwrt $(1)/www/cgi-bin/wolwrt
	$(INSTALL_DATA) ./files/usr/share/wolwrt/warn.ps1 $(1)/usr/share/wolwrt/warn.ps1
endef

define Package/wolwrt/postinst
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || /etc/init.d/rpcd reload
endef

$(eval $(call BuildPackage,wolwrt))
