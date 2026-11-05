---
name: poshakh-ui
description: Poshakh's UI conventions — spacing tokens, layout of screens and panels, which Button variant/size to use, the Actions and ModalHeader components, and how to write English + Marathi strings. Use whenever adding or changing any screen, modal, button, list row, or user-facing text in this app.
---

# Paridhan (Poshakh) UI conventions

Everything here is implemented in `src/components/ui.tsx`. Import from there; never
hand-roll a button, header, or spacing value in a screen.

The app is used by a tailor, often one-handed, often in Marathi. Big touch targets,
plain words, one obvious main action per block.

## 1. Spacing — only use the tokens

```ts
SPACE  = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 }
LAYOUT = {
  gutter: 12,       // screen edge → white panel (Section, Card, <Actions page>)
  inset: 16,        // panel edge → its content (text, inputs, button groups)
  sectionGap: 16,   // between two panels (built into Section / Actions page)
  rowY: 12,         // vertical padding of one list row inside a panel
  buttonGap: 8,     // between buttons in a group (built into Actions)
  screenBottom: 32, // paddingBottom of every ScrollView / FlatList content
  radius: 12, radiusSm: 8,
}
```

Rules:
- No raw numbers for `margin*`, `padding*` or `gap` in screens. Use `SPACE.*` or `LAYOUT.*`.
  The only exception is `marginTop: 2` between a title line and its subtitle line.
- Horizontal content padding inside a panel is always `LAYOUT.inset`.
- A list row inside a panel is `paddingHorizontal: LAYOUT.inset, paddingVertical: LAYOUT.rowY`,
  separated by `<Separator />`.
- Scroll content: `contentContainerStyle={{ paddingBottom: LAYOUT.screenBottom }}`.
- Don't override `Section`'s top margin to squeeze things together.

## 2. Screen layout

```
<View style={{ flex: 1, backgroundColor: COLORS.bgLight, paddingTop: insets.top }}>
  <ScreenHeader title=… subtitle=… right=… />        // tab screens
  ── or ──
  <ModalHeader title=… subtitle=… onBack=… right=… /> // full-screen modals (back arrow)
  [optional toolbar: white bar, padding LAYOUT.gutter, gap SPACE.sm]
  <ScrollView contentContainerStyle={{ paddingBottom: LAYOUT.screenBottom }}>
    <Section title=…>…</Section>       // every group of content is its own white panel
    <Section title=…>…</Section>
    <Actions page>…</Actions>          // buttons that belong to the whole screen
  </ScrollView>
  [optional sticky footer: white, borderTop, paddingHorizontal LAYOUT.gutter, paddingVertical SPACE.sm]
</View>
```

- `ModalHeader` takes `children` instead of a title when the header holds something else
  (e.g. the search box in Today's search).
- `Section accent={color}` gives the coloured left edge: danger = will miss, warning = needs a
  reply, success = ready / delivered, emergency = urgent part.

## 3. Buttons — always `<Button>`

| variant       | use for                                                       |
|---------------|---------------------------------------------------------------|
| `primary`     | the main action of a block (at most one per block)            |
| `secondary`   | every other action                                            |
| `danger`      | destructive actions (cancel order)                            |
| `ghost`       | low-key text actions (edit price, load demo data)             |
| `dangerGhost` | low-key destructive text action (remove a blouse)             |
| `success`     | a toggled "on" state (paid ✓)                                 |
| `whatsapp`    | send on WhatsApp                                              |

| size     | use for                                                              |
|----------|----------------------------------------------------------------------|
| `normal` | page-level actions (`<Actions page>`), sticky footers                |
| `small`  | anything inside a Section: list rows, panel actions, header actions  |

- Icons come from the `icon` prop (Ionicons name), **not** emoji or `‹ › + ✓` in the label.
  `iconRight` for "Next / forward" buttons. Common icons: `checkmark` (done), `checkmark-done`
  (delivered), `calendar-outline` (date), `call-outline`, `receipt-outline` (bill),
  `logo-whatsapp`, `share-social-outline`, `save-outline`, `add-circle-outline`, `trash-outline`,
  `chevron-back` / `chevron-forward`, `cloud-upload-outline` / `cloud-download-outline`.
- Never pass margins to a Button. Spacing comes from its container.
- Disabled = `disabled` prop (it fades itself). Busy = `disabled` + label `STRINGS.loading`.

## 4. Grouping buttons — `<Actions>`

```tsx
<Actions>…</Actions>           // inside a Section, stacked, inset padding
<Actions row>…</Actions>       // inside a Section, side by side, equal widths
<Actions page>…</Actions>      // on the grey background between panels
```

`Actions` drops `false`/`null` children, so `{cond && <Button …/>}` is fine.
A single button at the right of a list row is placed directly in the row (no Actions).

## 5. Brand (Paridhan)

- App and brand name: **Paridhan** / **परिधान** (`STRINGS.appName`). The code folder and DB file
  still say "poshakh" — leave those, renaming the DB loses data.
- Colours: `COLORS.brand` (plum `#440023`, also `COLORS.accent`), `COLORS.brandRose` (`#B20854`),
  `COLORS.brandTint` (light pink box). Don't introduce other accent colours.
- Logo: `<BrandLogo width={…} />` (white-background crop, `assets/logo/logo-bill.png`). Always a
  fixed numeric width: a % width makes Android draw it at full pixel size. Used on the bill and at the top
  of Settings. Source files live in `assets/logo/`; app icons / splash are generated from them.

## 6. Other components

`Card` (tappable summary in a list), `Section`, `Separator`, `Row`, `Tag` (status chip),
`Segmented` (2–3 way toggle; give it `style={{ marginHorizontal: LAYOUT.inset, marginVertical: SPACE.sm }}`
inside a Section), `TextField`, `NumberInput`, `NumericTextInput`, `DateField`, `Checkbox`,
`EmptyState`, `Loading`, `IconButton` (round icon in a ScreenHeader), `CapacityStrip`, `Steps`.

## 7. Text and languages

- Every user-facing string lives in `src/strings/en.ts`, with the same key in `src/strings/mr.ts`
  (TypeScript enforces matching keys). Read via `STRINGS.key`.
- Marathi must sound spoken, not translated. Keep the words people really use:
  ऑर्डर, ब्लाउज, डिलिव्हरी, सेव्ह करा, अर्जंट, बिल, WhatsApp. Use गिऱ्हाईक (not ग्राहक),
  नेहमीचे (not साधे), short colloquial forms (झालं, दिलं, करायचं). Avoid bookish words
  like जतन, तातडीचे, प्रविष्ट करा.
- Labels on buttons are verbs or short phrases; no trailing punctuation or symbols.

## 8. Checklist before finishing a UI change

- [ ] No raw spacing numbers in the new styles (`grep -nE "(margin|padding|gap)[A-Za-z]*: [0-9]+" src/screens`).
- [ ] No `TouchableOpacity` used as a button where `<Button>` fits (rows that open a detail are fine).
- [ ] Buttons grouped with `<Actions>`; icons via `icon`, not emoji.
- [ ] New strings added to both `en.ts` and `mr.ts`.
- [ ] `npx tsc --noEmit`, `npx expo lint`, `npm test` pass.
