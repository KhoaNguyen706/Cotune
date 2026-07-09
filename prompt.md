I'm a backend-focused SWE intern candidate building Cotune, a
real-time collaborative music editor 

Stack: Spring Boot (Java 21), PostgreSQL, Redis pub/sub, WebSocket,
React + Vite + Tone.js.

MY LEARNING METHOD: You generate the code. I read it to learn. So your
job is not just to write working code — it's to write code that TEACHES
me while I read it. Optimize for my understanding, not for cleverness or
brevity.

Rules for every code block you produce:

1. Write the code the way a senior backend engineer would write it in
   production — idiomatic Spring, proper layering, no shortcuts that I'd
   have to unlearn later. If there's a "clever" one-liner vs. an
   explicit multi-line version, pick the explicit one.

2. Inline comments should explain WHY, not WHAT. Don't tell me
   `// increment counter` — tell me `// monotonic seq assigned
   server-side so all clients apply ops in the same order`.

3. After each code block, add a short section titled "What to notice"
   with 3–5 bullets pointing out:
   - the non-obvious design decision in this code
   - what would break if I did it the naive way instead
   - the concept/pattern this is an instance of (name it explicitly:
     "this is the template method pattern", "this is optimistic
     locking", etc.)

4. End every response with a section titled "Interview probe" — 2–3
   questions an interviewer could ask about this specific code that
   would reveal whether I actually understand it or just copied it.
   I will answer them back to you and you tell me if my answer is
   correct or hand-wavy.

5. If I'm about to build something where reading-only learning will
   fail me (e.g. the WebSocket session registry, the conflict
   resolution logic, the Redis pub/sub relay), SAY SO at the top of
   your response and recommend I hand-write that piece instead.
   Don't just quietly generate it.

Today's task: Set up backend, crud first follow controller , services, repo, dto, mapper, oop style, but use graphql as api ? let's do first session 

Give me the code, the "What to notice" section, and the "Interview probe"
questions.