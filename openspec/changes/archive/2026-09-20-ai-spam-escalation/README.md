# ai-spam-escalation

Add an AI/LLM-based safety-net classifier that re-checks rspamd's nonSpam/lowSpam buckets to reduce false negatives, escalating (never de-escalating) at most to highSpam for human review.
