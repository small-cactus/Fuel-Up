/**
 * Predictive Fueling Live Activity — driving-centric, brand-forward design.
 *
 * ╔═════════════════════════════════════════════════════════════════╗
 * ║ KEEP IN SYNC WITH src/lib/PriceDropActivityLivePreview.jsx       ║
 * ╠═════════════════════════════════════════════════════════════════╣
 * ║ PriceDropActivityLivePreview.jsx is the in-app design previewer  ║
 * ║ for this widget. It hand-mirrors the JSX below using the same   ║
 * ║ `@expo/ui/swift-ui` primitives wrapped in `<Host>` so you can    ║
 * ║ iterate on layout/colors inside the app without swiping home.    ║
 * ║ Any change to the banner, compact, minimal, or expanded layouts  ║
 * ║ — or to the shared color constants / headline logic — MUST be    ║
 * ║ mirrored in that file, or the previews will drift from the      ║
 * ║ real Live Activity.                                              ║
 * ║                                                                  ║
 * ║ The duplication is forced by the babel widgets-plugin, which    ║
 * ║ replaces this function with a serialized string literal — the    ║
 * ║ preview needs a normal React callable, so it lives in its own    ║
 * ║ non-widget file. See that file's header for details.             ║
 * ╚═════════════════════════════════════════════════════════════════╝
 *
 * The user is ACTIVELY DRIVING. They get at most a one-second glance at
 * the lock screen or a shorter glance at the Dynamic Island. Everything
 * on screen answers ONE question: "Is it worth pulling into this station
 * instead of the next one?"
 *
 * Visual hierarchy (most → least):
 *   1. Branded FuelUp badge — instant WHO is speaking.
 *   2. "$4.20 cheaper just ahead" — the surprise "magic moment" that
 *      justifies the notification at all. Savings up front, so the
 *      driver sees value before being asked a question.
 *   3. "Costco Gas · 3 min detour" — quiet context line.
 *   4. Two full-width rectangular buttons — large, tactile hit
 *      targets so the driver can act one-handed without looking.
 *
 * The registered widget target name stays `PriceDropActivity` to match
 * `app.json` and `ios/ExpoWidgetsTarget/PriceDropActivity.swift`.
 *
 * ╔═════════════════════════════════════════════════════════════════╗
 * ║ IMPORTANT — SERIALIZATION BOUNDARY                              ║
 * ╠═════════════════════════════════════════════════════════════════╣
 * ║ `babel-preset-expo`'s widgets-plugin serializes the function     ║
 * ║ tagged with `'widget'` via `@babel/generator` on the bare        ║
 * ║ function node. Closure variables, module-scope constants, and    ║
 * ║ module-scope helpers are NOT captured — they become free        ║
 * ║ identifiers in the string that the JSContext later evaluates.    ║
 * ║ The ONLY names that resolve at runtime are:                      ║
 * ║   • Components/modifiers copied from `@expo/ui/swift-ui` into    ║
 * ║     globalThis by `expo-widgets/bundle/index.ts`                 ║
 * ║   • `_jsx`/`_jsxs` from the bundled jsx-runtime stub             ║
 * ║   • Standard JS globals (`Math`, `Number`, `String`, …)          ║
 * ║                                                                  ║
 * ║ Every color, every helper, every label goes INSIDE the function. ║
 * ║ Referencing a module-scope `const` throws `ReferenceError` in    ║
 * ║ the widget JSContext and the banner renders as an EmptyView.     ║
 * ╚═════════════════════════════════════════════════════════════════╝
 *
 * ╔═════════════════════════════════════════════════════════════════╗
 * ║ WHY THE BUTTONS ARE HAND-DRAWN                                   ║
 * ╠═════════════════════════════════════════════════════════════════╣
 * ║ SwiftUI's `.buttonStyle(.borderedProminent)` FORCES a rounded    ║
 * ║ capsule/pill shape at `.large` control size, regardless of any   ║
 * ║ frame modifier you apply. There is no "make this borderedProm    ║
 * ║ button a rectangle" API.                                         ║
 * ║                                                                  ║
 * ║ To get actual flat-rectangle buttons that span the container     ║
 * ║ width, we use `.buttonStyle(.plain)` — which strips ALL default  ║
 * ║ styling — and draw the button's visual ourselves: a ZStack       ║
 * ║ containing a filled RoundedRectangle (= the rectangle shape)     ║
 * ║ behind an HStack (= the icon + text label). `frame(maxWidth:     ║
 * ║ 999999)` on the outer Button fills the available width, so two  ║
 * ║ buttons in an HStack split 50/50 and become true full-width      ║
 * ║ rectangles, not pills.                                           ║
 * ║                                                                  ║
 * ║ The Button still routes taps through                             ║
 * ║ `LiveActivityUserInteraction` via the `target` prop, so          ║
 * ║ Navigate/Cancel still flow to the main app's                     ║
 * ║ `addLiveActivityInteractionListener`.                            ║
 * ╚═════════════════════════════════════════════════════════════════╝
 */
import {
    Button,
    HStack,
    Image,
    RoundedRectangle,
    Spacer,
    Text,
    VStack,
    ZStack,
} from '@expo/ui/swift-ui';
import {
    buttonStyle,
    font,
    foregroundStyle,
    frame,
    monospacedDigit,
    padding,
} from '@expo/ui/swift-ui/modifiers';
import { createLiveActivity } from 'expo-widgets';

export type PredictiveFuelingActivityProps = {
    /** Display name of the station — e.g. "Wawa" */
    stationName: string;
    /** Optional street / exit hint — e.g. "Route 73" */
    subtitle?: string;
    /** Price per gallon as a plain number string, e.g. "3.19" (no $) */
    price: string;
    /** Per-gallon savings vs local average as a number string, e.g. "0.30". */
    savingsPerGallon?: string;
    /** Estimated total savings on a typical fill-up, e.g. "4.20". Headline value. */
    totalSavings?: string;
    /** Distance remaining in miles as a number string, e.g. "0.4" */
    distanceMiles: string;
    /** Estimated minutes to arrive, e.g. "1" */
    etaMinutes: string;
    /** Approach progress, 0.0 to 1.0. */
    progress: number;
    /** Short one-line status, e.g. "On your route" | "Almost there" | "Arrived" */
    status: string;
    /** Which visual state to render. */
    phase?: 'approaching' | 'arriving' | 'arrived' | 'passed';
};

const PriceDropActivity = (props: PredictiveFuelingActivityProps) => {
    'widget';

    // ── Colors (all local — see serialization boundary note above) ──
    //
    // The FuelUp brand badge uses a yellow→orange diagonal gradient
    // identical to the app icon. The pump glyph inside is pure white.
    const BRAND_YELLOW = '#FFDC4A';
    const BRAND_ORANGE = '#FF9A2E';

    // Action button colors — iOS system tones (dark-mode variants) so
    // they feel native and are high-contrast on both light and dark
    // notification backgrounds.
    const ACTION_BLUE = '#0A84FF';
    const ACTION_RED = '#FF453A';

    // Secondary accents.
    const ACCENT_GREEN = '#30D158';
    const URGENT_AMBER = '#FF9F0A';
    const accent = props.phase === 'passed' ? URGENT_AMBER : ACCENT_GREEN;

    // ── Savings detection ──
    const savingsNumber = Number(props.totalSavings);
    const hasTotalSavings = Number.isFinite(savingsNumber) && savingsNumber > 0;
    const totalSavingsLabel = hasTotalSavings ? props.totalSavings : '0';

    // ── ETA formatting ──
    const etaCompactLabel = props.etaMinutes === '<1'
        ? '<1 min'
        : (props.etaMinutes + ' min');

    // ── Magic-moment copy ──
    //
    // Lead with the dollar amount when there's savings — this turns the
    // notification into a surprise "you just found money" moment instead
    // of a decision-making question. Fall back to a calmer "on your
    // route" framing when there's nothing to save.
    const headline = hasTotalSavings
        ? '$' + totalSavingsLabel + ' cheaper just ahead'
        : props.stationName + ' is on your route';

    const positionLine = hasTotalSavings
        ? props.stationName + ' · ' + etaCompactLabel + ' detour'
        : props.distanceMiles + ' mi ahead · ' + etaCompactLabel + ' away';

    // ── Brand badge ──
    //
    // Recreates the FuelUp app icon in primitives: a rounded-square
    // tile filled with a top-left → bottom-right yellow→orange
    // gradient, with a white fuel pump glyph centered on top. Declared
    // once as a variable so the banner and Dynamic Island expanded
    // layouts share one source of truth.
    const brandBadge = (
        <ZStack alignment="center">
            <RoundedRectangle
                cornerRadius={14}
                modifiers={[
                    frame({ width: 52, height: 52 }),
                    foregroundStyle({
                        type: 'linearGradient',
                        colors: [BRAND_YELLOW, BRAND_ORANGE],
                        startPoint: { x: 0, y: 0 },
                        endPoint: { x: 1, y: 1 },
                    }),
                ]}
            />
            <Image systemName="fuelpump.fill" color="#FFFFFF" size={28} />
        </ZStack>
    );

    // ── Action buttons ──
    //
    // Using the native `label` + `systemImage` props instead of custom
    // children (ZStack + RoundedRectangle). The widget extension's
    // DynamicView.swift render method silently swallows errors from the
    // `Children()` path and returns EmptyView, which made the hand-drawn
    // buttons invisible. The `label` prop takes the reliable Text/Label
    // rendering path in LiveActivityButtonView.swift and always renders.
    //
    // `borderedProminent` gives a filled, tinted pill — the native look
    // for Live Activity action buttons.
    const navigateButton = (
        <Button
            target="navigate"
            systemImage="location.north.fill"
            label="Navigate"
            modifiers={[
                buttonStyle('borderedProminent'),
                foregroundStyle('#FFFFFF'),
            ]}
        />
    );

    const cancelButton = (
        <Button
            target="cancel"
            label="Cancel"
            role="destructive"
            modifiers={[
                buttonStyle('bordered'),
            ]}
        />
    );

    return {
        /* ───────────────── Banner (lock screen / Notification Center) ─────────────────
         *
         * Two stacked rows, generous padding:
         *
         *   Row 1: [FuelUp badge]   $4.20 cheaper just ahead
         *                            📍 Costco Gas · 3 min detour
         *
         *   Row 2: [ ▶ Navigate (blue)  ]  [ Cancel (red)         ]
         */
        banner: (
            <VStack
                modifiers={[padding({ horizontal: 18, vertical: 16 })]}
                alignment="leading"
                spacing={16}
            >
                {/* Row 1 — Brand badge + headline + position */}
                <HStack spacing={14} alignment="center">
                    {brandBadge}

                    <VStack alignment="leading" spacing={4}>
                        <Text
                            modifiers={[
                                font({ size: 18, weight: 'semibold' }),
                                foregroundStyle({ type: 'hierarchical', style: 'primary' }),
                            ]}
                        >
                            {headline}
                        </Text>
                        <HStack spacing={5} alignment="center">
                            <Image systemName="location.fill" color={accent} size={11} />
                            <Text
                                modifiers={[
                                    font({ size: 14, weight: 'medium', design: 'rounded' }),
                                    monospacedDigit(),
                                    foregroundStyle({ type: 'hierarchical', style: 'secondary' }),
                                ]}
                            >
                                {positionLine}
                            </Text>
                        </HStack>
                    </VStack>

                    <Spacer />
                </HStack>

                {/* Row 2 — Two full-width rectangular buttons */}
                <HStack spacing={10} alignment="center">
                    {navigateButton}
                    {cancelButton}
                </HStack>
            </VStack>
        ),

        /* ───────────────── Dynamic Island — compact ─────────────────
         *
         * Driver's attention belongs on the road — show only the
         * savings number and a fuel pump glyph.
         */
        compactLeading: (
            <HStack modifiers={[padding({ leading: 4 })]}>
                <Image
                    systemName="fuelpump.fill"
                    color={accent}
                    size={15}
                />
            </HStack>
        ),
        compactTrailing: (
            <HStack spacing={1} modifiers={[padding({ trailing: 4 })]} alignment="lastTextBaseline">
                <Text
                    modifiers={[
                        font({ size: 13, weight: 'semibold', design: 'rounded' }),
                        foregroundStyle(accent),
                    ]}
                >
                    $
                </Text>
                <Text
                    modifiers={[
                        font({ size: 14, weight: 'bold', design: 'rounded' }),
                        monospacedDigit(),
                        foregroundStyle(accent),
                    ]}
                >
                    {totalSavingsLabel}
                </Text>
            </HStack>
        ),
        minimal: (
            <Image systemName="fuelpump.circle.fill" color={accent} size={16} />
        ),

        /* ───────────────── Dynamic Island — expanded ─────────────────
         *
         * Mirrors the banner: badge leading, savings hero trailing,
         * context + action rectangles in the bottom region.
         */
        expandedLeading: (
            <VStack modifiers={[padding({ leading: 8, top: 4 })]}>
                {brandBadge}
            </VStack>
        ),
        expandedTrailing: (
            <VStack
                modifiers={[padding({ trailing: 10, top: 4 })]}
                alignment="trailing"
                spacing={2}
            >
                <HStack spacing={1} alignment="lastTextBaseline">
                    <Text
                        modifiers={[
                            font({ size: 14, weight: 'semibold', design: 'rounded' }),
                            foregroundStyle(accent),
                        ]}
                    >
                        SAVE $
                    </Text>
                    <Text
                        modifiers={[
                            font({ size: 26, weight: 'bold', design: 'rounded' }),
                            monospacedDigit(),
                            foregroundStyle(accent),
                        ]}
                    >
                        {totalSavingsLabel}
                    </Text>
                </HStack>
                <Text
                    modifiers={[
                        font({ size: 11, weight: 'medium' }),
                        foregroundStyle({ type: 'hierarchical', style: 'secondary' }),
                    ]}
                >
                    at {props.stationName}
                </Text>
            </VStack>
        ),
        expandedBottom: (
            <VStack
                modifiers={[padding({ horizontal: 14, bottom: 12 })]}
                alignment="leading"
                spacing={10}
            >
                <HStack spacing={5} alignment="center">
                    <Image systemName="location.fill" color={accent} size={12} />
                    <Text
                        modifiers={[
                            font({ size: 13, weight: 'medium', design: 'rounded' }),
                            monospacedDigit(),
                            foregroundStyle({ type: 'hierarchical', style: 'primary' }),
                        ]}
                    >
                        {positionLine}
                    </Text>
                    <Spacer />
                </HStack>
                <HStack spacing={8} alignment="center">
                    <Button
                        target="navigate"
                        systemImage="location.north.fill"
                        label="Navigate"
                        modifiers={[
                            buttonStyle('borderedProminent'),
                            foregroundStyle('#FFFFFF'),
                        ]}
                    />
                    <Button
                        target="cancel"
                        label="Cancel"
                        role="destructive"
                        modifiers={[
                            buttonStyle('bordered'),
                        ]}
                    />
                </HStack>
            </VStack>
        ),
    };
};

export default createLiveActivity<PredictiveFuelingActivityProps>(
    'PriceDropActivity',
    PriceDropActivity,
);
