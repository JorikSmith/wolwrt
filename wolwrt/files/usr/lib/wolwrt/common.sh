. /lib/functions.sh
. /lib/functions/network.sh
. /usr/share/libubox/jshn.sh

WOLWRT_STATE=/var/run/wolwrt
WOLWRT_KEY=/etc/wolwrt/id_ed25519
WOLWRT_REPO=JorikSmith/wolwrt

die() {
	echo "wolwrt: $*" >&2
	exit 1
}

run_timeout() {
	local secs=$1 pid watcher rc
	shift
	"$@" &
	pid=$!
	( sleep "$secs"; kill "$pid" 2>/dev/null ) >/dev/null 2>&1 &
	watcher=$!
	wait "$pid"
	rc=$?
	kill "$watcher" 2>/dev/null
	return $rc
}

lang_ru() {
	[ "$(uci -q get luci.main.lang)" = ru ]
}

error_text() {
	local name
	config_get name "$2" name "$2"
	if lang_ru; then
		case "$1" in
		no_response) echo "WOLwrt: $name не включился за 5 минут" ;;
		wake_failed) echo "WOLwrt: не удалось отправить magic packet на $name" ;;
		sleep_failed) echo "WOLwrt: не удалось выключить $name" ;;
		webhook_failed) echo "WOLwrt: webhook правила $name не прошел" ;;
		*) echo "WOLwrt: ошибка $1, $name" ;;
		esac
	else
		case "$1" in
		no_response) echo "WOLwrt: $name did not come online in 5 min" ;;
		wake_failed) echo "WOLwrt: could not send magic packet to $name" ;;
		sleep_failed) echo "WOLwrt: could not turn off $name" ;;
		webhook_failed) echo "WOLwrt: webhook of rule $name failed" ;;
		*) echo "WOLwrt: error $1, $name" ;;
		esac
	fi
}

log_event() {
	local kind=$1 event=$2 id=$3 detail=$4 size notify
	logger -t wolwrt "$event $id${detail:+: $detail}"
	mkdir -p "$WOLWRT_STATE"
	json_init
	json_add_int ts "$(date +%s)"
	json_add_string kind "$kind"
	json_add_string event "$event"
	json_add_string id "$id"
	[ -n "$detail" ] && json_add_string detail "$detail"
	config_get size main history_size 100
	{
		flock 9
		json_dump >> "$WOLWRT_STATE/history"
		tail -n "$size" "$WOLWRT_STATE/history" > "$WOLWRT_STATE/history.tmp"
		mv "$WOLWRT_STATE/history.tmp" "$WOLWRT_STATE/history"
	} 9> "$WOLWRT_STATE/history.lock"
	[ "$kind" = bad ] && [ "$event" != notify_failed ] || return 0
	config_get_bool notify main notify_errors 0
	[ "$notify" = 1 ] && ( tg_send "$(error_text "$event" "$id")" >/dev/null 2>&1 & )
	return 0
}

urlencode() {
	printf %s "$1" | hexdump -v -e '/1 "%02x"' | sed 's/../%&/g'
}

fetch_ext() {
	local out=$1 url=$2 data=$3 proxy
	config_get proxy main proxy
	if [ -z "$proxy" ]; then
		if [ -n "$data" ]; then
			run_timeout 60 uclient-fetch -q -T 30 -O "$out" --post-data="$data" "$url"
		else
			run_timeout 120 uclient-fetch -q -T 30 -O "$out" "$url"
		fi
		return
	fi
	command -v curl >/dev/null || {
		logger -t wolwrt "proxy is set but curl is not installed"
		return 1
	}
	case "$proxy" in
	socks5://*) proxy="socks5h://${proxy#socks5://}" ;;
	socks4://*) proxy="socks4a://${proxy#socks4://}" ;;
	esac
	if [ -n "$data" ]; then
		run_timeout 60 curl -sfL --connect-timeout 20 -m 55 -x "$proxy" -d "$data" -o "$out" "$url"
	else
		run_timeout 120 curl -sfL --connect-timeout 20 -m 115 -x "$proxy" -o "$out" "$url"
	fi
}

tg_ready() {
	local token chat
	config_get token main tg_token
	config_get chat main tg_chat
	[ -n "$token" ] && [ -n "$chat" ]
}

tg_send() {
	local token chat
	config_get token main tg_token
	config_get chat main tg_chat
	[ -n "$token" ] && [ -n "$chat" ] || return 0
	fetch_ext /dev/null "https://api.telegram.org/bot$token/sendMessage" \
		"chat_id=$(urlencode "$chat")&text=$(urlencode "$1")"
}

rule_allowed() {
	local id=$1 days from to cooldown last hm
	RULE_DENY=days
	config_get days "$id" days
	[ -z "$days" ] || list_contains days "$(date +%a | tr 'A-Z' 'a-z')" || return 1
	RULE_DENY=window
	config_get from "$id" time_from
	config_get to "$id" time_to
	if [ -n "$from" ] || [ -n "$to" ]; then
		from=${from:-00:00}
		to=${to:-23:59}
		hm=$(date +%H:%M)
		if [ "$from" \> "$to" ]; then
			[ "$hm" \< "$from" ] && [ "$hm" \> "$to" ] && return 1
		else
			{ [ "$hm" \< "$from" ] || [ "$hm" \> "$to" ]; } && return 1
		fi
	fi
	RULE_DENY=pause
	config_get cooldown "$id" cooldown 0
	read -r last 2>/dev/null < "$WOLWRT_STATE/rule.$id"
	[ -z "$last" ] || [ $(($(date +%s) - last)) -ge $((cooldown * 60)) ]
}

target_is_online() {
	[ "$(jsonfilter -i "$WOLWRT_STATE/status.json" -e "@.targets.$1.online" 2>/dev/null)" = true ]
}

rule_off() {
	local target=$1 woken idle limit
	read -r woken _ 2>/dev/null < "$WOLWRT_STATE/woken.$target"
	if [ "$woken" != wolwrt ]; then
		target_is_online "$target" && log_event off sleep_skipped "$target" manual || log_event off sleep_skipped "$target" off
		return 2
	fi
	config_get limit "$target" idle_min 0
	if [ "$limit" -gt 0 ] && idle=$(wolwrt idle "$target" 2>/dev/null) && [ "$idle" -lt "$limit" ]; then
		log_event off sleep_skipped "$target" active
		return 2
	fi
	wolwrt sleep "$target"
}

rule_run() {
	local id=$1 name action target url message notify rc=0
	config_get name "$id" name "$id"
	config_get action "$id" action
	config_get target "$id" target
	config_get_bool notify "$id" notify 1
	mkdir -p "$WOLWRT_STATE"
	date +%s > "$WOLWRT_STATE/rule.$id"
	log_event ok rule "$id" "$action${target:+ $target}"
	case "$action" in
	wake)
		wolwrt wake "$target" || rc=1
		;;
	sleep)
		rule_off "$target"
		rc=$?
		[ $rc -eq 2 ] && return 0
		;;
	webhook)
		config_get url "$id" url
		if ! http_call POST "$url" "rule=$id"; then
			log_event bad webhook_failed "$id" "$url"
			rc=1
		fi
		;;
	notify)
		config_get message "$id" message "$name"
		if ! tg_ready; then
			log_event bad notify_failed "$id" setup
			return 1
		fi
		tg_send "$message" && return 0
		log_event bad notify_failed "$id"
		return 1
		;;
	*)
		die "$id: unknown action $action"
		;;
	esac
	[ "$notify" = 1 ] && tg_send "WOLwrt: $name"
	return $rc
}

target_ip() {
	local mac
	[ -n "$2" ] && echo "$2" && return
	mac=$(echo "$1" | tr 'A-F' 'a-f')
	awk -v m="$mac" '$2 == m { print $3; exit }' /tmp/dhcp.leases 2>/dev/null | grep . ||
		ip -4 neigh show | awk -v m="$mac" '$5 == m { print $1; exit }'
}

target_load() {
	local type
	config_get type "$1" TYPE
	[ "$type" = target ] || die "unknown target: $1"
	config_get name "$1" name "$1"
	config_get mac "$1" mac
	config_get ip "$1" ip
	ip=$(target_ip "$mac" "$ip")
	config_get network "$1" network lan
	config_get off_method "$1" off_method none
	config_get ssh_user "$1" ssh_user root
	config_get ssh_port "$1" ssh_port 22
	config_get ssh_cmd "$1" ssh_cmd
	config_get warn_delay "$1" warn_delay 60
	config_get http_method "$1" http_method GET
	config_get http_url "$1" http_url
	config_get http_body "$1" http_body
	config_get sol_port "$1" sol_port 8009
}

ssh_run() {
	[ -n "$ip" ] || die "$name: no IP address"
	[ -f "$WOLWRT_KEY" ] || die "no router SSH key, run: wolwrt pubkey"
	run_timeout 20 dbclient -y -T -i "$WOLWRT_KEY" -p "$ssh_port" "$ssh_user@$ip" "$1" </dev/null 2>/dev/null
}

target_online() {
	ip neigh flush to "$1" >/dev/null 2>&1
	ping -c 1 -W 1 "$1" >/dev/null 2>&1 && return 0
	ip neigh show to "$1" | grep -q REACHABLE
}

http_call() {
	local method=$1 url=$2 body=$3
	if [ "$method" = POST ]; then
		run_timeout 15 uclient-fetch -q -T 10 -O /dev/null --post-data="$body" "$url"
	else
		run_timeout 15 uclient-fetch -q -T 10 -O /dev/null "$url"
	fi
}
