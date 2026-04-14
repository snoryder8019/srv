#!/bin/bash
# MadLabs Security Report — run any time for a quick threat snapshot

BOLD='\033[1m'
RED='\033[0;31m'
YEL='\033[0;33m'
GRN='\033[0;32m'
NC='\033[0m'

echo ""
echo -e "${BOLD}═══════════════════════════════════════════${NC}"
echo -e "${BOLD}    MADLABS SECURITY REPORT$(date '+  %Y-%m-%d %H:%M')${NC}"
echo -e "${BOLD}═══════════════════════════════════════════${NC}"

echo ""
echo -e "${BOLD}── FAIL2BAN JAILS ──${NC}"
for jail in sshd apache-404 apache-scanner apache-badbots recidive; do
  status=$(fail2ban-client status $jail 2>/dev/null)
  banned=$(echo "$status" | grep "Banned IP" | awk -F: '{print $2}' | wc -w)
  total=$(echo "$status" | grep "Total banned" | awk -F: '{print $2}' | tr -d ' ')
  color=$GRN
  [ "$banned" -gt 0 ] 2>/dev/null && color=$YEL
  [ "$banned" -gt 10 ] 2>/dev/null && color=$RED
  echo -e "  ${color}$jail${NC}: $banned active bans | $total total"
done

echo ""
echo -e "${BOLD}── TOP ATTACKERS (last hour) ──${NC}"
since=$(date -d '1 hour ago' '+%d/%b/%Y:%H' 2>/dev/null || date -v-1H '+%d/%b/%Y:%H')
grep "$since" /var/log/apache2/access.log 2>/dev/null | \
  awk '{print $1}' | sort | uniq -c | sort -rn | head -8 | \
  while read count ip; do
    [ "$count" -gt 20 ] && color=$RED || color=$YEL
    echo -e "  ${color}${ip}${NC} — $count requests"
  done

echo ""
echo -e "${BOLD}── ATTACK TYPES (last 500 lines) ──${NC}"
tail -500 /var/log/apache2/access.log 2>/dev/null | \
  grep -oP '"(GET|POST) \K[^ ]+' | \
  grep -E "\.(php|env|sh)|wp-|shell|eval|\.git" | \
  sed 's/\?.*//' | sort | uniq -c | sort -rn | head -10 | \
  while read count path; do
    echo -e "  ${RED}$count${NC}x $path"
  done

echo ""
echo -e "${BOLD}── HTTP STATUS SUMMARY (last 1000) ──${NC}"
tail -1000 /var/log/apache2/access.log 2>/dev/null | \
  awk '{print $9}' | sort | uniq -c | sort -rn | \
  while read count code; do
    [[ "$code" == 4* ]] && color=$YEL || color=$GRN
    [[ "$code" == 5* ]] && color=$RED
    echo -e "  ${color}HTTP $code${NC}: $count"
  done

echo ""
echo -e "${BOLD}── MEMORY ──${NC}"
free -h | awk 'NR==2{printf "  RAM: %s used / %s total (%.0f%% free)\n", $3, $2, ($4/$2)*100}'

echo ""
echo -e "${BOLD}── VSCODE WATCHDOG ──${NC}"
if tail -5 /var/log/vscode-watchdog.log 2>/dev/null | grep -q "Killing"; then
  echo -e "  ${YEL}Recent kills:${NC}"
  tail -3 /var/log/vscode-watchdog.log
else
  echo -e "  ${GRN}No runaway processes detected${NC}"
fi
echo ""
