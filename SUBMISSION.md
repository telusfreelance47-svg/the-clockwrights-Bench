# The Clockwright's Bench: Submission

This is an entry for the Handshake AI Skills Studio "Create a Multiplayer Game" mission (OpenAI). Deadline: **Oct 30, 2026, 11:59 PM PT**.

The entry form asks for four things: a title, a cover image, a description and a link. Each one is below, ready to paste.

---

## a. Project title

```
The Clockwright's Bench: Fix the Village Clock Together
```

## b. Project cover image

![The Clockwright's Bench cover](clockwright_cover.jpg)

Upload `clockwright_cover.jpg` from this folder (also saved as `covers/clockwrights-bench-poster.jpg`). It's a portrait poster (784×1168): the cracked village clock with its pendulum, the Gear Train, Spring Tension and Chime Rack modules, the torn manual pages, a clean-repair streak, a guild rank and a STRIKE stamp.

If the form crops to a landscape frame, use `covers/clockwrights-bench-cover.jpg` instead (a 1600×900 screenshot of the bench mid-clock).

## c. Project description

**Short version** (use this if the form limits length):

```
Play alone right now: tap Practice alone. A cooperative repair game for 2 to 6 players. Three clocks, one torn manual, and every apprentice holds only a few pages. Talk, trust and press the right part before the pendulum stops. Join from any phone with a four-letter code. Built for friends on a call, families and team-building sessions.
```

**Full version:**

```
Play alone right now: enter a name and tap Practice alone, and two bot apprentices join you at the bench.

The village clock has stopped at midnight. You and your fellow apprentices stand at one workbench, repairing three clocks of rising difficulty before the town wakes. Everyone sees the same broken mechanism, but the repair manual is torn into pages and each apprentice holds only a few. Nobody can fix anything alone: the operator of each module never holds that module's pages. The team has to find out who holds the page that matters, read it out, and trust each other to press the right part.

How it plays:
• Each clock has three modules: Gear Train (colour and teeth), Spring Tension (marking and coil) and Chime Rack (bell and tone). Each shows a symptom plate with six possible actions.
• The rule map is shuffled every game, so nobody can memorise the answers.
• Clock 1 needs one repair per module in 120 seconds, clock 2 needs two in 150, clock 3 needs three in 180.
• A wrong press is a strike and flips a new plate. Three strikes seize the clock.
• Linked gears (from clock 2): repairing the Gear Train turns the Spring Tension, and on clock 3 the Spring turns the Chime Rack, so any answer already found for the driven module is wasted. The team has to agree on a repair order.
• A team debrief after every clock shows questions asked, average answer time, how many presses were backed by a page versus guessed, and a Foreman's tip for the next clock.

Details:
• Join from any phone or laptop with a four-letter code. No login, no install.
• Silent Bench mode uses read-outs, "Who has this?" and quick chips. Talk It Out mode is for groups on a call.
• Practice bots talk: they say which pages they hold, warn about the linkage, and react to strikes and repairs.
• The rule map and other players' pages never leave the server. Disconnected players' pages are handed round after 15 seconds.
• A pendulum timer that slows as time runs low, strike stamps, stars that land one at a time, a clean-repair streak and a shareable result card.
• Guild ranks from Sweeper of Shavings to Timekeeper Royal, eight guild medals, and awards for Steady Hands, Best Reader and Quick Eyes.
```

## d. Project link

```
https://the-clockwrights-bench.onrender.com/
```

Source: https://github.com/telusfreelance47-svg/the-clockwrights-Bench

---

## Quick start for a judge (about 8 minutes)

1. Open the link, type a name and tap **Practice alone**.
2. Look at a module's symptom plate. If none of your pages match, tap **Ask Ada** or **Ask Bram** on that module. Their answer appears in the Bench Notes after about 3 seconds (for example "Green 3 → Remove Gear 4").
3. Press the action the page names. A wrong press is a strike; three strikes seize the clock.
4. From clock 2, watch the linked gears: repair the Spring Tension before the Gear Train, or the Spring's plate turns and the answer is wasted.
5. After each clock, read the team debrief. After clock 3, see the stars, awards and your guild rank.

## Before you submit

- [x] Pushed to GitHub (Oct 28).
- [x] Deployed on Render (Oct 28). `/healthz` returns ok and a practice workshop opens over wss.
- [ ] Add an UptimeRobot monitor on the `/healthz` URL so the free instance doesn't sleep.
- [ ] Playtest the linked gears on clocks 2 and 3 with at least one other person.
- [ ] Play one full practice game on the live link, on a phone and on a laptop.
- [ ] Paste the title, upload the cover, paste the description, and paste the link.
