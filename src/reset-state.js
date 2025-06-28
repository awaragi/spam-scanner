const now = new Date();
const last_uid = 1;
const last_seen_date = now.toISOString();
const last_checked = now.toISOString();

console.log(JSON.stringify({
    last_uid,
    last_seen_date,
    last_checked
}, null, 2));
