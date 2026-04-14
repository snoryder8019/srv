#!/bin/bash
# Runs daily — logs security summary to file, you can check it anytime
LOG=/var/log/madlabs-security-digest.log
echo "" >> $LOG
echo "══════════════════════════════════════" >> $LOG
echo "DAILY DIGEST: $(date)" >> $LOG
echo "══════════════════════════════════════" >> $LOG

# Banned IP counts
for jail in sshd apache-404 apache-scanner apache-badbots recidive; do
  total=$(fail2ban-client status $jail 2>/dev/null | grep "Total banned" | awk -F: '{print $2}' | tr -d ' ')
  echo "$jail total bans: $total" >> $LOG
done

# Top 5 attackers from past 24h
echo "Top attackers (24h):" >> $LOG
grep "$(date '+%d/%b/%Y')" /var/log/apache2/access.log 2>/dev/null | \
  awk '{print $1}' | sort | uniq -c | sort -rn | head -5 >> $LOG

echo "Memory: $(free -h | awk 'NR==2{print $3"/"$2}')" >> $LOG
