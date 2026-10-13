# Chat label defensibility audit

- Scope: the fixed proportional DEV400 sample has 37 chat items.
- The first audit covers all 13 items where both c576 free direct replay and the completed crowd stage score below 1.
- This conservative intersection includes partial order disagreements. A split is not proof that either label is wrong.
- Read evidence: every request, both original replies, and all direct/crowd comparison replies in `chat-label-audit-evidence-c576.json`.
- The approved three-sample architecture is fixed before this audit. Labels, audit findings and item IDs do not enter model input.

| Item / label | Defensible? | Request or reply quotes | Reason |
|---|---|---|---|
| 3187 / B | Yes, preference tradeoff | B: “Fer un pressupost et pot ajudar a planificar”; A: “podries desplaçar-te a peu” | B supplies an expense-tracking and budgeting method. Orthographic weaknesses can reasonably matter less than that substance. Both judges split by order. |
| 3181 / A | Yes | A: “Si em dones més informació”; B: “deixar la tecla del quadrat premuda” | A asks for the missing device context. B gives a device-dependent instruction and leaves iPhone unanswered. Specific but unreliable instructions need not beat clarification. |
| 3221 / B | Yes, weak taste distinction | Request: “nichts mit Verkäufen”; B: “Taschenlampe oder Toastbrot”; A: “nicht versehentlich in die Taschenlampe zu beißen” | B offers multiple public interaction ideas. A proposes juggling and biting. A payout game is not necessarily a sale; neither idea set dominates on creativity or safety. The refraction claim remains unverified. |
| 3252 / B | Yes, factual identity remains uncertain | Request: “Wer bist du?”; B: “Im Kontext dieses Gesprächs”; crowd: “The deployment context describes a Claude agent” | B relates its identity answer to the earlier requested writing role. The judge imports its own Claude identity into the source assistant. LAION/architecture specifics are not proven by the supplied conversation. |
| 3259 / A | Yes | Request: “in Deutschland oder pro Tonne Zement”; A: “etwa 600 kg”; B: “0,8 bis 1 Tonne” | “Oder” gives alternative examples, not two mandatory fields. A answers per-tonne emissions and the process split. The judges impose an AND constraint and discount its better German intensity figure. |
| 3279 / B | Yes, qualified adoption claim | Request: “Are any array languages”; B: “has not yet been widely adopted”; A: “niche use cases” | The request asks whether any are used, not whether every named language is mainstream. B includes examples and an explicit BQN caveat. Its headline and body can be read together. Deployment specifics remain unverified. |
| 3348 / A | Yes, close pair | A: “cost of conversion and retraining”; B: “International trade” | Both give benefits and transition caveats. A's specific costs provide a defensible preference; B's trade discussion also supports a preference. Both judges split. |
| 3389 / B | Yes, factual ranking remains uncertain | B: “ordenados de menor a mayor”; A: “532,9 km/h” | The request does not require descending order or km/h only. B states its ordering and supplies conversions and details. Both lists need historical speed-claim verification; disagreement does not prove B's label false. |
| 3501 / A | Yes | A: “cette variation ne dépend pas”; B: “il y a l'Orchestre ... de New York” | A directly answers the comparison. B's typical sizes do not establish a difference, and its parallel New York example omits the historical merger. More numbers need not mean better responsiveness. |
| 3522 / A | Yes, both replies have substantive errors | A: “Ceph RADOS Gateway”; B: “Менеджеры не обязательны” | A covers gateway and dashboard, but misattributes placement to monitors. B incorrectly treats managers as optional for normal modern operation. The crowd calls B's optional-manager claim correct. A's broader component coverage is a defensible tradeoff. |
| 3531 / B | Yes | Request: “вкратце”; B: “Некоторые из основных факторов”; crowd: “the Syrian government changed in late 2024” | B offers a shorter overview as requested. The judges discount explicit brevity and import their present date into an undated source conversation. This audit does not verify either response's current geopolitical claims. |
| 3576 / B | Yes, weak tradeoff | Request: “详细讲讲”; B: “異步、解耦”; direct: “wrong script variant” | B addresses requested detail and decoupling, although repetitive and weak on the split. Simplified versus Traditional is not a requested language constraint. A is short and also conceptually incomplete. |
| 3591 / B | Yes, close pair | B: “##### 酸+碱 => 盐+水”; A: “# 酸 + 碱 -------- 盐 + 水”; crowd: “truncated antacid line” | Both share nearly all listed chemistry. Formatting and the extra example can support B's label. The crowd mistakes the 240-character opening excerpt for a truncated original line; the complete original contains the products. Both lists include reactions outside strict neutralization. |

## Additional native-direct intersection item

| Item / label | Defensible? | Quotes | Reason |
|---|---|---|---|
| 3458 / B | Yes | Request: “presentación del documento en Word”; B: “Editor de Microsoft”, “secciones y subtítulos claros” | B names Word features and document structure appropriate to a thesis. The judges alternately call the actual Editor feature a factual problem or merely loose naming. A's typography advice is useful, but the label can reasonably prefer B's context and software specificity. |

The native current-request run adds 3458 to the conservative joint-miss intersection. Its complete request, both candidates and four comparisons are read from `chat-label-audit-native-evidence.json`. No model input changes follow.

## Primary checks

- Google's Android help describes navigation-dependent app closing. Its current instructions use a recents gesture or a tap, not a universal long press on a square button. This supports caution in 3181; it does not establish every historical device's behavior. [Android Help](https://support.google.com/android/answer/9079646?hl=en-GB_ALL).
- VDZ describes German cement intensity near 600 kg CO2 per tonne and the process/fuel split near two thirds/one third. This supports A's central figure in 3259. It does not verify every 2018 employment or turnover number. [VDZ climate protection](https://www.vdz-online.de/en/cement-industry/climate-protection-1).
- New York Philharmonic's archive describes the New York Symphony merger in 1928. This supports caution about B's example in 3501. [NY Philharmonic archive](https://exhibits.nyphil.org/dailydocument/).
- Ceph's documentation requires a manager for normal operation from Luminous, while clients and OSDs use CRUSH for placement. Both replies in 3522 have an error; the alleged correctness advantage for B is overstated. [Ceph Manager](https://docs.ceph.com/en/pacific/mgr/index.html), [Ceph architecture](https://docs.ceph.com/en/quincy/architecture/).

- Microsoft identifies Editor as Word's spelling, grammar and style feature. This supports the tool reference in 3458, rather than the judge's allegation of a factual problem. [Microsoft Editor in Word](https://support.microsoft.com/es-es/word/training/check-grammar-spelling-and-more-in-word).

## Audited ceiling, separate from the official score

- Confirmed indefensible labels in the audited intersection: 0 of 13.
- The strict ceiling implied by proven label defects is 100%: `(37 - 0) / 37`.
- This is an audit bound, not a measured Haiku ceiling or a prediction that 100% is achievable.
- The initial 13-item intersection leaves 24 labels outside that view. The native-current view and the union of audited IDs are recorded separately at completion. Taste uncertainty and unverifiable claims do not justify relabelling.
- Official chat scores remain 67.57% direct free replay and 66.22% crowd. No label is changed and no diagnostic correction enters design selection.
- The native current-request measurement will determine a second intersection; additional items are audited before handover.

## Completed native-current intersection

- Native current-contract direct and crowd both score below 1 on 14 of the 37 chat items. All 14 labels have the quoted defenses above.
- The native intersection is the initial 13 IDs plus 3458. Its complete inputs and comparisons are retained in `chat-label-audit-native-evidence.json`.
- Confirmed indefensible labels: 0 of 14 audited. The strict label-defect ceiling bound remains 100%; 23 other labels are outside this selected audit.
- No relabelled score is reported, and no suspect-label correction enters selection or the voting code.
