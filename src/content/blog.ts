import type { CoverVariant } from "@/components/blog-cover";

/**
 * Blog content, stored as structured blocks rather than markup.
 *
 * Keeping the body as data means the renderer owns every style decision, so
 * an article cannot quietly introduce its own typography, and the whole set
 * stays consistent as the design changes.
 */
export type Block =
  | { t: "p"; text: string }
  | { t: "h2"; text: string }
  | { t: "h3"; text: string }
  | { t: "ul"; items: string[] }
  | { t: "ol"; items: string[] }
  | { t: "quote"; text: string }
  | { t: "table"; head: string[]; rows: string[][] };

export type Post = {
  slug: string;
  title: string;
  excerpt: string;
  tag: string;
  author: string;
  role: string;
  date: string;
  readingMinutes: number;
  cover: CoverVariant;
  body: Block[];
};

export const POSTS: Post[] = [
  {
    slug: "cut-days-in-ar-below-40",
    title: "How to cut days in A/R below 40, and keep it there",
    excerpt:
      "Days in accounts receivable is the metric every practice quotes and few can move. The fix is rarely working the queue harder. It is finding the three places the clock is quietly running.",
    tag: "Revenue cycle",
    author: "CollaboratMD",
    role: "Revenue cycle notes",
    date: "2026-09-18",
    readingMinutes: 7,
    cover: "aging",
    body: [
      {
        t: "p",
        text: "Days in accounts receivable measures how long revenue sits uncollected after the visit. The industry target is under 40 days, and most practices that miss it do not miss it by a little. They sit at 55, 60, sometimes past 70, and the explanation offered is almost always the same: the payers are slow.",
      },
      {
        t: "p",
        text: "Payers are slow. They are also consistent. Medicare pays on a schedule you can set a watch by, and the large commercial plans are not far behind. When a practice runs at 60 days against payers that adjudicate in 18, the delay is not coming from the payer. It is coming from the three gaps on either side of them.",
      },
      { t: "h2", text: "Gap one: the lag before submission" },
      {
        t: "p",
        text: "The A/R clock starts at the date of service, not at the date you submit. Every day a charge waits in a drafts queue is a day of aging that no payer caused and no collections effort can recover. It is also the cheapest day to eliminate.",
      },
      {
        t: "p",
        text: "Measure the interval between date of service and submission date, and measure it as a distribution rather than an average. The average hides the problem. What matters is the tail: the 5% of claims that sit for two weeks because a coder had a question nobody answered, or because a provider had not signed the note.",
      },
      {
        t: "ul",
        items: [
          "Track the oldest claim in the ready queue as a standing number, not a report you run monthly.",
          "Set a hard rule that nothing sits in drafts past 48 hours without an owner and a reason.",
          "Route unsigned notes to the provider daily, not weekly. A note that blocks a claim is a financial document.",
        ],
      },
      { t: "h2", text: "Gap two: the rework loop" },
      {
        t: "p",
        text: "A claim that is rejected by the clearinghouse or denied by the payer does not restart the clock. It keeps aging while somebody figures out what went wrong, corrects it and resubmits. A single rework cycle typically adds 14 to 21 days.",
      },
      {
        t: "p",
        text: "This is why clean claim rate and days in A/R move together, and why chasing the second without fixing the first is wasted effort. If 12% of your claims need rework, roughly one claim in eight is carrying an extra three weeks of age, and that alone will hold the practice above 45 days no matter how well the follow-up team performs.",
      },
      {
        t: "quote",
        text: "A denial found three weeks later costs a phone call, an appeal and a month of aging. The same error found before submission costs ten seconds.",
      },
      {
        t: "p",
        text: "The highest-return work here is unglamorous. Take the denial reasons from the last quarter, rank them by dollars, and turn the top five into validation rules that fire at charge entry. Missing or invalid diagnosis pointers, place of service contradicting the procedure, a modifier the payer does not accept on that code, an NPI that fails its check digit: all of these are knowable before submission.",
      },
      { t: "h2", text: "Gap three: the balance nobody owns" },
      {
        t: "p",
        text: "After the payer adjudicates, part of the balance transfers to the patient. In many practices that transfer is where aging goes to hide, because insurance A/R and patient A/R are reported as one number. Insurance receivable resolving in 22 days and patient receivable resolving in 90 average out to something that looks acceptable and is not.",
      },
      {
        t: "p",
        text: "Separate them. Report insurance A/R and patient A/R as distinct figures with distinct targets, and give patient balances their own workflow: an estimate collected at check-in, a statement that follows the patient-friendly format, and a defined escalation path. Practices that split the two almost always discover the insurance side was healthier than they thought and the patient side was worse.",
      },
      { t: "h2", text: "What good looks like" },
      {
        t: "table",
        head: ["Metric", "Target", "Why it matters here"],
        rows: [
          ["Date of service to submission", "Under 3 days", "Pure aging you control completely"],
          ["Clean claim rate", "95% or better", "Every rework cycle adds 14 to 21 days"],
          ["Days in A/R, insurance", "Under 35 days", "Measures payer cycle plus your follow-up"],
          ["Days in A/R, patient", "Under 45 days", "Hidden inside a blended figure"],
          ["A/R over 90 days", "Under 15%", "The tail that rarely gets collected"],
        ],
      },
      {
        t: "p",
        text: "Work the three gaps in order and the headline number falls without anyone working longer hours. Submission lag is the fastest to fix, rework is the largest in dollars, and the patient balance split is the one that stops the number drifting back up six months later.",
      },
      { t: "h2", text: "The measurement trap" },
      {
        t: "p",
        text: "One last warning, because it catches more practices than any of the above. Days in A/R is normally computed as ending receivable divided by average daily charge. If the denominator uses a 12-month average while the practice has grown, the metric flatters you. If it uses a 30-day window during a slow month, it punishes you. Pick a 90-day average daily charge, document the choice, and stop changing it. A metric you can move by changing its formula is not a metric.",
      },
    ],
  },

  {
    slug: "five-denial-codes-that-cost-the-most",
    title: "The five denial codes that cost practices the most",
    excerpt:
      "In most practices, denial dollars concentrate in a handful of reason codes. Here is what each one really means and what stops it.",
    tag: "Denials",
    author: "CollaboratMD",
    role: "Revenue cycle notes",
    date: "2026-09-11",
    readingMinutes: 8,
    cover: "denials",
    body: [
      {
        t: "p",
        text: "Denial management often gets organized around volume: work the biggest pile first. That is the wrong sort. Denials are enormously skewed by dollar value, and a hundred small office visit denials can be worth less than four surgical ones. Sort by dollars at risk and the queue reorders completely.",
      },
      {
        t: "p",
        text: "When a practice does that, the same few Claim Adjustment Reason Codes account for most of the exposure. They are worth understanding individually, because the fix for each is different and three of them are preventable before submission.",
      },
      { t: "h2", text: "CARC 16: claim lacks information" },
      {
        t: "p",
        text: "The most common denial and the most misread. CARC 16 is not one problem, it is a container, and the actual cause sits in the accompanying Remittance Advice Remark Code. Working CARC 16 without reading the RARC is how practices end up resubmitting the same claim twice and getting the same denial back.",
      },
      {
        t: "ul",
        items: [
          "N286 points at a missing or invalid referring provider identifier.",
          "MA27 and MA36 point at missing patient identity or name details.",
          "N382 means the patient could not be identified as insured at all.",
        ],
      },
      {
        t: "p",
        text: "Almost all of it is preventable. Validate the referring NPI at charge entry, check the member identifier format against the payer's published pattern, and require the subscriber relationship field rather than defaulting it to self.",
      },
      { t: "h2", text: "CARC 197: precertification or authorization absent" },
      {
        t: "p",
        text: "The most expensive denial in most specialty practices, because it attaches to exactly the procedures that carry the largest charges. Imaging, surgery, infusion and durable medical equipment sit at the top of the list.",
      },
      {
        t: "p",
        text: "CARC 197 is also the denial with the weakest appeal position. If authorization was genuinely required and genuinely not obtained, the appeal usually fails, and the practice either writes it off or bills the patient depending on what the contract permits. That makes prevention the only real strategy.",
      },
      {
        t: "p",
        text: "The control that works is a CPT-level authorization matrix maintained per payer, checked at scheduling rather than at billing. By the time the charge is entered the service has already been rendered, which is far too late for the answer to be useful.",
      },
      { t: "h2", text: "CARC 27: expenses incurred after coverage terminated" },
      {
        t: "p",
        text: "A pure eligibility failure, and the easiest of the five to eliminate. The patient's coverage ended before the date of service, and nobody checked. It shows up most in practices that verify eligibility at registration and never again, then see the patient monthly for a year.",
      },
      {
        t: "p",
        text: "Run a 270 eligibility request before every visit, not just the first one, and store the 271 response against the encounter. That stored response matters: when a payer later disputes coverage, a timestamped eligibility record is the difference between an appeal you win and one you cannot substantiate.",
      },
      { t: "h2", text: "CARC 11: diagnosis inconsistent with the procedure" },
      {
        t: "p",
        text: "A coding problem rather than an administrative one, and the one most likely to indicate something systematically wrong rather than a one-off slip. It means the diagnosis submitted does not support medical necessity for the procedure under the payer's coverage policy.",
      },
      {
        t: "p",
        text: "Two causes dominate. The first is a diagnosis pointer error, where the correct code is on the claim but the line points at the wrong one. That is mechanical and a scrubber catches it. The second is genuine: the documented diagnosis does not meet the National or Local Coverage Determination for that service, which is a conversation with the provider, not a correction on the claim.",
      },
      { t: "h2", text: "CARC 45: charge exceeds fee schedule" },
      {
        t: "p",
        text: "The odd one out, because it is usually not a denial at all. CARC 45 is a contractual adjustment: the payer paid its allowed amount and wrote the difference off against your contract. It appears in denial reports because reporting tools group all adjustment codes together.",
      },
      {
        t: "p",
        text: "It becomes a real problem in one case, which is worth watching for: when the allowed amount does not match the contracted rate. That is not a denial, it is an underpayment, and it will keep happening silently on every claim under that contract until somebody compares the remittance against the fee schedule.",
      },
      { t: "h2", text: "Sorting the work" },
      {
        t: "table",
        head: ["Code", "Preventable?", "Where the fix belongs"],
        rows: [
          ["16", "Yes", "Validation at charge entry"],
          ["197", "Yes", "Authorization check at scheduling"],
          ["27", "Yes", "Eligibility request before every visit"],
          ["11", "Partly", "Scrubber for pointers, provider for necessity"],
          ["45", "N/A", "Contract and fee schedule reconciliation"],
        ],
      },
      {
        t: "p",
        text: "Three of the five never need to reach a payer. The remaining two are a coding conversation and a contracting one. None of them is solved by a larger follow-up team, which is why practices that staff their way out of a denial problem tend to find it waiting for them the following year.",
      },
    ],
  },

  {
    slug: "what-clean-claim-rate-actually-measures",
    title: "What clean claim rate actually measures, and what it hides",
    excerpt:
      "Most practices report a clean claim rate above 95%. Many of them are measuring the wrong thing, and the number goes up precisely when the process gets worse.",
    tag: "Metrics",
    author: "CollaboratMD",
    role: "Revenue cycle notes",
    date: "2026-09-04",
    readingMinutes: 6,
    cover: "clean",
    body: [
      {
        t: "p",
        text: "Clean claim rate is the share of claims accepted on first submission without rework. It is one of the few revenue cycle metrics that is genuinely predictive: it drives days in A/R, it drives cost to collect, and it moves before the financial statements do.",
      },
      {
        t: "p",
        text: "It is also the metric most often defined into meaninglessness, because every step of the pipeline offers a different place to measure it, and the flattering place is easy to pick by accident.",
      },
      { t: "h2", text: "Three definitions, three different numbers" },
      {
        t: "ol",
        items: [
          "Claims that pass your own scrubber. This measures your software, not your process, and it approaches 100% by construction because you do not submit the failures.",
          "Claims accepted by the clearinghouse. Better, but the clearinghouse checks format and basic edits, not payer-specific policy.",
          "Claims adjudicated on first submission without rejection, denial or resubmission. This is the number that matters, and it is always the lowest of the three.",
        ],
      },
      {
        t: "p",
        text: "A practice quoting 99% is usually quoting the first definition. The same practice measured against the third often lands between 85% and 92%. Neither number is dishonest. They simply answer different questions, and only the third one predicts anything about cash.",
      },
      { t: "h2", text: "The perverse incentive" },
      {
        t: "p",
        text: "Here is where the metric turns on you. If clean claim rate is measured at the scrubber and the team is held to it, the rational response is to loosen the scrubber. Fewer blocking rules means fewer claims held back, which means a higher pass rate and a dashboard that improves while the denial queue quietly fills.",
      },
      {
        t: "quote",
        text: "Any metric measured at the gate you control will improve when you open the gate.",
      },
      {
        t: "p",
        text: "The same logic explains a pattern worth watching for: a clean claim rate that rises at the same time as the denial rate. That combination is not ambiguous. It means claims that should have been stopped are going out.",
      },
      { t: "h2", text: "Measuring it honestly" },
      {
        t: "p",
        text: "Define the denominator as all claims submitted in a period, and the numerator as those that reached a paid or finalized status without a rejection, a denial or a corrected resubmission. Exclude nothing. In particular, do not exclude claims that were denied and later paid on appeal, because the rework is exactly what the metric exists to count.",
      },
      {
        t: "ul",
        items: [
          "Report it by payer. A blended figure hides the one plan that rejects a quarter of what you send.",
          "Report it by provider. New providers and new locations generate predictable early errors.",
          "Report it by rule. Knowing which validation fires most tells you where training pays.",
        ],
      },
      { t: "h2", text: "What to do with a bad number" },
      {
        t: "p",
        text: "A low clean claim rate is good news in one respect: the causes are finite and they repeat. Pull the rejections and denials from a single month, group them by reason, and you will usually find that five causes account for two thirds of the volume. Each one becomes either a validation rule, a field that can no longer be left empty, or a short conversation with the person entering it.",
      },
      {
        t: "p",
        text: "Resist the urge to make every rule blocking. A scrubber that stops a claim for a cosmetic issue trains people to click past warnings, and then the warning that mattered gets clicked past too. Block what the payer will certainly reject. Warn on the rest, and watch whether the warnings correlate with denials before promoting them.",
      },
      {
        t: "p",
        text: "One more thing, because it is the most common measurement error of all: count a corrected resubmission as a failure of the original claim, not as a new claim. Practices that count it as new get a clean claim rate that improves every time they rework something, which is precisely backwards.",
      },
    ],
  },

  {
    slug: "reading-an-835-remittance",
    title: "Reading an 835 remittance line by line",
    excerpt:
      "The 835 is the most information-dense document in the revenue cycle and the least read. Here is how to follow one from the payment header down to a single service line.",
    tag: "EDI",
    author: "CollaboratMD",
    role: "Revenue cycle notes",
    date: "2026-08-27",
    readingMinutes: 9,
    cover: "remittance",
    body: [
      {
        t: "p",
        text: "The 835 Health Care Claim Payment and Advice is where the payer tells you exactly what it did and why. Most practices never look at one directly, because the billing system posts it automatically and shows a summary. That works until a payment does not reconcile, and then the ability to read the raw transaction is the difference between an answer and a guess.",
      },
      { t: "h2", text: "The shape of the document" },
      {
        t: "p",
        text: "An 835 nests four levels deep, and understanding the nesting is most of the battle:",
      },
      {
        t: "ol",
        items: [
          "The interchange and functional group, which identify sender, receiver and version.",
          "The financial information: one payment, its total amount, its method and its trace number.",
          "One or more claim payment loops, each covering a single claim you submitted.",
          "Inside each claim, one service payment loop per service line.",
        ],
      },
      {
        t: "p",
        text: "The single most useful habit is to check that the levels reconcile upward. Every service line adjustment should roll into the claim, and every claim payment should roll into the financial total. When it does not, the discrepancy is almost always at a level nobody looked at.",
      },
      { t: "h2", text: "The payment header" },
      {
        t: "p",
        text: "The BPR segment carries the total paid, the payment method and the effective date. The TRN segment carries the trace number, and it is the field that matters most operationally: it is what ties the electronic remittance to the deposit that shows up in the bank account. If a deposit cannot be matched to a remittance, the trace number is where you start.",
      },
      { t: "h2", text: "The claim level" },
      {
        t: "p",
        text: "The CLP segment opens each claim loop and carries six things worth reading every time:",
      },
      {
        t: "table",
        head: ["Element", "What it tells you"],
        rows: [
          ["Patient control number", "Your claim number, the join back to your system"],
          ["Claim status code", "1 processed as primary, 4 denied, 22 reversal"],
          ["Total charged", "What you billed"],
          ["Total paid", "What the payer is sending"],
          ["Patient responsibility", "What transfers to the patient"],
          ["Payer claim control number", "The payer's identifier, required on appeals"],
        ],
      },
      {
        t: "p",
        text: "Status code 22 deserves particular attention. It is a reversal, meaning the payer is taking back a previous payment, usually to replace it with a corrected one. If your posting logic treats a reversal as an ordinary payment, the ledger will double count and the error can sit undetected for months.",
      },
      { t: "h2", text: "The service line" },
      {
        t: "p",
        text: "The SVC segment gives the procedure code, the charged amount, the paid amount and the units. Beneath it, CAS segments explain every dollar of the difference, and this is where the real information lives.",
      },
      {
        t: "p",
        text: "Each CAS carries a group code and one or more reason codes. The group code determines who absorbs the amount, and getting it wrong is the most consequential posting error in the revenue cycle:",
      },
      {
        t: "ul",
        items: [
          "CO, contractual obligation: your write-off under the contract. The patient cannot be billed.",
          "PR, patient responsibility: deductible, copay or coinsurance. This transfers to the patient.",
          "OA, other adjustment: usually coordination of benefits, pointing at a secondary payer.",
          "PI, payer initiated reduction: the payer's own decision, often appealable.",
        ],
      },
      {
        t: "quote",
        text: "Charged equals paid plus every CAS amount on the line. If that equation does not balance, something was not posted.",
      },
      { t: "h2", text: "Remark codes" },
      {
        t: "p",
        text: "LQ segments carry Remittance Advice Remark Codes, which qualify the reason codes above them. A CARC of 16 with a RARC of N286 is a specific, actionable instruction. A CARC of 16 alone is close to useless. Any posting process that discards remark codes is throwing away the part of the message that tells you what to do next.",
      },
      { t: "h2", text: "Why posting automatically is not the same as posting blindly" },
      {
        t: "p",
        text: "Automatic posting is correct and worth doing. What it should never do is collapse detail. Keep the group code, the reason code and the remark code on every ledger entry. The moment they are summarized into a single adjustment amount, you lose the ability to answer the two questions that actually matter: why was this reduced, and can we appeal it?",
      },
      {
        t: "p",
        text: "Practices that preserve that detail can rank denials by dollars, find underpayments against contracted rates, and prove what a payer said on a date. Practices that do not are left reading a number and trying to remember.",
      },
    ],
  },

  {
    slug: "eligibility-checks-that-prevent-denials",
    title: "Eligibility checks that prevent denials before the visit",
    excerpt:
      "A 270 request costs pennies and takes seconds. Run at the right moment, it removes an entire category of denial. Run at the wrong moment, it tells you nothing you can use.",
    tag: "Front office",
    author: "CollaboratMD",
    role: "Revenue cycle notes",
    date: "2026-08-20",
    readingMinutes: 6,
    cover: "eligibility",
    body: [
      {
        t: "p",
        text: "Eligibility verification is the highest-return activity in the revenue cycle and the one most often treated as a registration formality. A 270 request costs a fraction of a cent and returns in seconds. A denial for terminated coverage costs an appeal, a rebill and a month of aging, and frequently ends as a write-off.",
      },
      {
        t: "p",
        text: "The gap between those two numbers is the whole argument. What gets in the way is not cost or effort. It is timing, and what the practice does with the answer.",
      },
      { t: "h2", text: "Check before every visit, not every patient" },
      {
        t: "p",
        text: "The common pattern is to verify coverage when a patient is registered and treat that as settled. For a practice seeing patients once, that is adequate. For a practice with an established panel seen monthly, it is the single largest source of preventable denials, because coverage changes between visits and nothing in the workflow notices.",
      },
      {
        t: "p",
        text: "Coverage changes cluster: at the start of the calendar year, at employer open enrollment, and when a patient changes jobs. A practice that batch-verifies its schedule 48 hours ahead catches all three. A practice that verifies at registration catches none of them.",
      },
      { t: "h2", text: "Read the whole 271, not just the yes" },
      {
        t: "p",
        text: "The 271 response is treated as a boolean by most front desks: active or not. It carries considerably more, and the rest is what makes the check financially useful.",
      },
      {
        t: "ul",
        items: [
          "Plan begin and end dates, which tell you whether the date of service falls inside coverage.",
          "Copay and coinsurance for the specific service type, not a generic office visit figure.",
          "Deductible, and crucially the remaining deductible, which is what the patient will owe today.",
          "Out-of-pocket maximum and progress toward it, which changes the answer entirely late in the year.",
          "Whether this plan is primary, and whether another payer is on file.",
        ],
      },
      {
        t: "p",
        text: "Remaining deductible is the field that turns eligibility from a compliance step into a collection step. A patient with a $3,000 deductible and $180 left on it owes almost nothing today. The same patient in January owes the full visit. Quoting a flat copay in both cases produces an undercollection in one and an argument in the other.",
      },
      { t: "h2", text: "Store the response against the encounter" },
      {
        t: "p",
        text: "This is the part practices skip, and it is the part that pays when a dispute arrives. Store the full 271 response, with its timestamp, attached to the specific encounter rather than to the patient record.",
      },
      {
        t: "quote",
        text: "When a payer denies for terminated coverage, a timestamped eligibility response showing active coverage on the date of service turns a write-off into an overturned denial.",
      },
      {
        t: "p",
        text: "Attaching it to the patient rather than the encounter loses the thing that matters, which is what the payer said on that date. Six visits later, the current response tells you nothing about the visit in dispute.",
      },
      { t: "h2", text: "Handle the ambiguous answers deliberately" },
      {
        t: "p",
        text: "Not every response is clean. Some payers return an active plan with no benefit detail. Some return nothing at all because their system is down. The failure mode is treating silence as a yes and moving on.",
      },
      {
        t: "ol",
        items: [
          "Active with full benefit detail: quote the patient's actual responsibility and collect it.",
          "Active without benefit detail: proceed, flag the encounter, and do not quote a figure you cannot support.",
          "Inactive or not found: stop and resolve it at the desk. This is the cheapest moment it will ever be.",
          "No response from the payer: retry, and record the failure. A missing check is not a passed check.",
        ],
      },
      { t: "h2", text: "What it is worth" },
      {
        t: "p",
        text: "In a practice of any size, eligibility failures typically account for a meaningful share of denied dollars, and nearly all of it is avoidable. The work is a batch job against tomorrow's schedule and a front desk that knows what to do with four possible answers. There is no cheaper revenue in the building.",
      },
    ],
  },
];

export function getPost(slug: string): Post | undefined {
  return POSTS.find((p) => p.slug === slug);
}

/** Newest first, which is how the index should read. */
export function sortedPosts(): Post[] {
  return [...POSTS].sort((a, b) => b.date.localeCompare(a.date));
}

export function formatPostDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}
