control_socket = "/tmp/rspamd.sock";

# Route DNS through the bundled unbound recursive resolver instead of the
# container's default resolver. Public resolvers are blocked by Spamhaus and
# other DNSBLs (returning "blocked" codes rather than real results), which
# degrades RBL/DNSBL accuracy.
dns {
  nameserver = ["unbound:53"];
}
