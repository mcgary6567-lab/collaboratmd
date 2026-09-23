# Investor outreach: finding healthcare IT VCs

Working notes, not a public page. The public-facing pitch lives at `/investors`.

## Using NFX Signal

[signal.nfx.com](https://signal.nfx.com/) is a free investor directory. It indexes investors by
**stage** (Pre-Seed, Seed, Series A) crossed with **sector**, and separately by geography. You
filter to a list, then work it.

The sector lists that match CollaboratMD, with the investor counts shown on the site as of
September 2026:

| Sector list | Pre-Seed | Seed | Series A | Why it fits |
|---|---|---|---|---|
| Health IT | 1,560 | 4,791 | 3,990 | The closest category. Start here. |
| Digital Health | 1,163 | 3,881 | 3,390 | Overlaps heavily; different firms index themselves here. |
| Health & Hospital Services | 1,693 | 4,738 | 3,642 | Provider-facing operations, which is the buyer. |
| SMB Software | 783 | 1,592 | 1,143 | The go-to-market motion, independent practices. |
| SaaS | 3,150 | 5,777 | 3,894 | Too broad alone, useful as a cross-reference. |
| Payments | 730 | 1,108 | 632 | Relevant because the product sits in the money path. |

There is also a **Colorado / Utah** geography list (351 investors). Being headquartered in South
Jordan is an advantage with regional funds, who see less competitive deal flow and often lead early
rounds.

**How to work it, in order:**

1. Filter to Health IT at your stage. Cross-reference against Digital Health and SMB Software. The
   investors appearing on two or more of those lists are the highest-fit names.
2. Cross-reference again against Colorado / Utah for a warm regional angle.
3. For each name, check the firm's recent investments. You want partners who have backed billing,
   claims, payments or practice management, not general digital health tourists.
4. Signal shows mutual connections through your network. A warm introduction converts at a
   different rate than a cold email; treat the cold list as the fallback.
5. Investors can be asked for intros to other investors. A partner who passes but likes the company
   is still worth asking.

Signal is a directory, not a verification service. Confirm a fund's current thesis, check size and
stage on its own site before you spend a slot on it. Funds change focus between vintages.

## Firm types worth researching

Verify each against its current portfolio before reaching out; these are starting points for
research, not endorsements or a claim about their present focus.

**Healthcare-dedicated funds.** Oak HC/FT, Flare Capital Partners, .406 Ventures, Define Ventures,
7wireVentures, Frist Cressey Ventures, LRVHealth, Echo Health Ventures, Transformation Capital,
Health Velocity Capital, Questa Capital. These understand payer and provider economics without
being taught, which shortens diligence considerably.

**Generalists with healthcare practices.** General Catalyst, Andreessen Horowitz (Bio + Health),
Bessemer Venture Partners, Venrock, F-Prime Capital, Bain Capital Ventures, SignalFire. Larger
checks, more competition for attention, more follow-on capacity.

**Utah and Mountain West.** Pelion Venture Partners, Album VC, Kickstart, Signal Peak Ventures,
Peterson Ventures, Mercato Partners, Sorenson Capital, EPIC Ventures. Geography is a real
advantage here, and these funds are reachable without a warm intro more often than coastal firms.

## What has to exist before you send the first email

The `/investors` page deliberately publishes no financials, because they would be stale and visible
to competitors. That means the data room has to be ready when someone asks, and the page promises a
response within one business day.

- [ ] Financial statements and an operating model with stated assumptions
- [ ] Capitalization table, including any SAFEs or notes already issued
- [ ] Customer pipeline with real names, stages and contract values
- [ ] Pricing, and the terms of any signed contract
- [ ] Architecture and security review, plus the HIPAA posture and any business associate agreements
- [ ] Product roadmap with an engineering plan behind it
- [ ] Team backgrounds and the hiring plan the round funds
- [ ] Round size, instrument and intended use of funds

Two of these deserve particular care in this category. **Security and HIPAA posture** will be
diligenced harder than in ordinary SaaS, because a breach at a billing vendor is a reportable event
for every practice it serves. And **customer evidence** matters more than product quality: the
product is demonstrably built, so the open question an investor has is whether practices switch.

## What not to do

Do not put revenue, customer counts, growth rates or valuation on the public page. If a number goes
up on the website it has to be true on the day someone reads it, and it will be quoted back during
diligence. Keep them in the data room where they carry a date and a context.

Do not describe the demo environment figures as customer results. The 105,000 claims and $62.7M in
billed charges are a synthetic dataset that proves the system performs at scale. Said plainly, that
is a real engineering claim and a good one. Said loosely, it is a misrepresentation that will be
found, and it will end the conversation.
