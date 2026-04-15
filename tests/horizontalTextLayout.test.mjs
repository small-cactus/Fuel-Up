/**
 * Horizontal-text line-wrapping guard — iPhone 17 Pro baseline.
 *
 * The home, onboarding, and settings screens all render Text elements inside
 * tight horizontal rows (grade selectors, choice buttons, action titles,
 * rating rows, price columns). On a "normal" sized iPhone (iPhone 17 Pro is
 * 393pt wide — Apple's baseline in the current HIG) these rows have only a
 * few dozen points of breathing room per cell, and any Text that doesn't
 * opt into `numberOfLines={1}` + `adjustsFontSizeToFit` can silently wrap
 * into two lines and break the layout (e.g. "$5.65" becoming "$5.6 / 5").
 *
 * This test enumerates every horizontal Text block that must stay on one
 * line and enforces the safety-net props by parsing the source files and
 * grepping for the exact JSX attributes. If someone deletes those props
 * later, or adds a new horizontal row without the protections, the test
 * fails here instead of waiting for a visual-regression bug report.
 *
 * Each guard also computes the usable column width on the iPhone 17 Pro
 * viewport (393pt - side margins - inner padding - inter-column gaps) and
 * verifies that — even at the configured `minimumFontScale` — the widest
 * realistic label (e.g. "Midgrade", "$10.99") fits without wrapping. This
 * catches a second class of regressions: layout drift that makes the
 * column narrower than the text *even after* the OS shrinks the font.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FUEL_SUMMARY_CARD_PATH = path.join(REPO_ROOT, 'src', 'components', 'FuelSummaryCard.js');
const HOME_SCREEN_PATH = path.join(REPO_ROOT, 'app', '(tabs)', 'index.js');
const ONBOARDING_PATH = path.join(REPO_ROOT, 'src', 'screens', 'OnboardingScreen.js');
const SETTINGS_PATH = path.join(REPO_ROOT, 'app', '(tabs)', 'settings.js');

// iPhone 17 Pro logical width in points. Source: Apple HIG.
const IPHONE_17_PRO_WIDTH = 393;

// SF Pro Display digit/letter glyph-width ratios at bold weight, measured
// empirically via CoreText on macOS 14. The constants here intentionally
// err on the wide side so the test flags risk early instead of tripping
// on real devices.
const SF_PRO_LETTER_WIDTH_RATIO = 0.58; // conservative bold letter width
const SF_PRO_GLYPH_OVERRIDES = {
    $: 0.68,
    '.': 0.28,
    '-': 0.34,
    M: 0.86,
    W: 0.90,
    i: 0.32,
    l: 0.32,
    ' ': 0.30,
    ',': 0.28,
};

function readSource(filePath) {
    return fs.readFileSync(filePath, 'utf8');
}

function extractNumericStyle(source, selector, propertyName) {
    const selectorRegex = new RegExp(
        `${selector}\\s*:\\s*\\{([\\s\\S]*?)\\}`,
        'm'
    );
    const selectorMatch = source.match(selectorRegex);
    if (!selectorMatch) {
        throw new Error(
            `Could not find style selector "${selector}" in source. Layout test needs this selector.`
        );
    }
    const body = selectorMatch[1];
    const propertyRegex = new RegExp(`${propertyName}\\s*:\\s*([\\-0-9.]+)`);
    const propertyMatch = body.match(propertyRegex);
    if (!propertyMatch) {
        throw new Error(
            `Could not find numeric property "${propertyName}" inside selector "${selector}".`
        );
    }
    return Number(propertyMatch[1]);
}

function extractNumericConstant(source, constantName) {
    const regex = new RegExp(`const\\s+${constantName}\\s*=\\s*([\\-0-9.]+);`);
    const match = source.match(regex);
    if (!match) {
        throw new Error(`Could not find numeric constant "${constantName}" in source.`);
    }
    return Number(match[1]);
}

function approximateGlyphWidth(character, fontSize) {
    const ratio = SF_PRO_GLYPH_OVERRIDES[character] ?? SF_PRO_LETTER_WIDTH_RATIO;
    return ratio * fontSize;
}

function approximateTextWidth(text, fontSize) {
    return Array.from(text).reduce(
        (total, character) => total + approximateGlyphWidth(character, fontSize),
        0
    );
}

function formatWidth(value) {
    return value.toFixed(2);
}

/**
 * Parse every <Text> JSX block in the given source and return the blocks
 * whose style string contains `styleSelectorSubstring`. Each returned
 * entry is the full JSX <Text>...</Text> slice, which callers can assert
 * against for the shrink-to-fit props.
 */
function findTextBlocksWithStyle(source, styleSelectorSubstring) {
    const blockRegex = /<Text\b[\s\S]*?<\/Text>/g;
    const matches = [];
    let match;
    while ((match = blockRegex.exec(source)) !== null) {
        if (match[0].includes(styleSelectorSubstring)) {
            matches.push(match[0]);
        }
    }
    return matches;
}

function assertTextBlockHasShrinkToFitProps({
    blocks,
    label,
    allowScaleBelow = 0.95,
}) {
    assert.ok(
        Array.isArray(blocks) && blocks.length > 0,
        `Expected at least one Text block for "${label}"`
    );

    blocks.forEach((block, index) => {
        const preview = block.slice(0, 240).replace(/\s+/g, ' ');

        assert.ok(
            /numberOfLines\s*=\s*\{\s*1\s*\}/.test(block),
            `[${label}#${index}] must set numberOfLines={1}.\nBlock: ${preview}`
        );
        assert.ok(
            /adjustsFontSizeToFit/.test(block),
            `[${label}#${index}] must set adjustsFontSizeToFit.\nBlock: ${preview}`
        );

        const minimumFontScaleMatch = block.match(
            /minimumFontScale\s*=\s*\{\s*(0?\.\d+)\s*\}/
        );
        assert.ok(
            minimumFontScaleMatch,
            `[${label}#${index}] must set minimumFontScale={0.x}.\nBlock: ${preview}`
        );
        const scale = Number(minimumFontScaleMatch[1]);
        assert.ok(
            scale > 0 && scale < allowScaleBelow,
            `[${label}#${index}] minimumFontScale must be > 0 and < ${allowScaleBelow}, got ${scale}.\nBlock: ${preview}`
        );
    });
}

// ============================================================================
// FuelSummaryCard layout constants
//
// The card was redesigned from a 4-column grade grid into a single-grade
// hero layout: the user's selected grade is the only price shown, in a much
// larger font, occupying the full content width. The price column is now
// "the entire content area" rather than 1/4 of it, so we measure against
// the inner content width (card outer minus content horizontal padding).
// ============================================================================

function buildFuelSummaryCardLayout() {
    const cardSource = readSource(FUEL_SUMMARY_CARD_PATH);
    const homeSource = readSource(HOME_SCREEN_PATH);

    const contentBlockHorizontalPadding = extractNumericStyle(
        cardSource,
        'contentBlock',
        'paddingHorizontal'
    );
    const cardPriceFontSize = extractNumericStyle(cardSource, 'cardPrice', 'fontSize');
    const sideMargin = extractNumericConstant(homeSource, 'SIDE_MARGIN');

    const cardOuterWidth = IPHONE_17_PRO_WIDTH - sideMargin * 2;
    const contentWidth = cardOuterWidth - contentBlockHorizontalPadding * 2;

    return {
        contentBlockHorizontalPadding,
        cardPriceFontSize,
        sideMargin,
        cardOuterWidth,
        contentWidth,
    };
}

test('iPhone 17 Pro viewport constants load from FuelSummaryCard + index.js', () => {
    const layout = buildFuelSummaryCardLayout();

    assert.ok(layout.contentBlockHorizontalPadding > 0);
    assert.ok(layout.cardPriceFontSize > 0);
    assert.ok(layout.sideMargin >= 0);
    assert.ok(layout.contentWidth > 0);
});

test('FuelSummaryCard hero price stays single-line for realistic prices', () => {
    const layout = buildFuelSummaryCardLayout();

    // The hero price now lives on a single full-width row so it has the
    // entire content width to play with. Realistic US prices include the
    // dollar sign, decimal point, and the appended "/ gal" suffix; we
    // measure them together to make sure the whole composition fits.
    const testPrices = [
        '$3.19', '$3.99', '$4.29', '$4.59', '$4.89',
        '$5.09', '$5.35', '$5.65', '$5.95', '$6.19',
        '$7.39', '$7.99', '$8.99', '$9.99', '$10.99',
    ];
    const suffix = ' / gal';

    const failures = [];
    testPrices.forEach(priceText => {
        const heroPriceWidth = approximateTextWidth(priceText, layout.cardPriceFontSize);
        // The /gal suffix renders ~0.4x of the hero price font size by design;
        // approximate that by measuring it at 0.4 * cardPriceFontSize.
        const suffixWidth = approximateTextWidth(suffix, layout.cardPriceFontSize * 0.4);
        const totalWidth = heroPriceWidth + suffixWidth;
        if (totalWidth > layout.contentWidth) {
            failures.push(
                `"${priceText}${suffix}" -> ${formatWidth(totalWidth)}pt > content ${formatWidth(layout.contentWidth)}pt`
            );
        }
    });

    if (failures.length > 0) {
        assert.fail(
            `Fuel hero price wraps on iPhone 17 Pro (${IPHONE_17_PRO_WIDTH}pt):\n  ` +
            failures.join('\n  ')
        );
    }
});

test('FuelSummaryCard cardPrice Text blocks carry shrink-to-fit props', () => {
    const source = readSource(FUEL_SUMMARY_CARD_PATH);
    const blocks = findTextBlocksWithStyle(source, 'styles.cardPrice');
    assertTextBlockHasShrinkToFitProps({ blocks, label: 'FuelSummaryCard cardPrice' });
});

test('FuelSummaryCard gradeLabelText Text blocks carry shrink-to-fit props', () => {
    const source = readSource(FUEL_SUMMARY_CARD_PATH);
    const blocks = findTextBlocksWithStyle(source, 'styles.gradeLabelText');
    assertTextBlockHasShrinkToFitProps({ blocks, label: 'FuelSummaryCard gradeLabelText' });
});

test('FuelSummaryCard gradeOctaneText Text blocks carry shrink-to-fit props', () => {
    const source = readSource(FUEL_SUMMARY_CARD_PATH);
    const blocks = findTextBlocksWithStyle(source, 'styles.gradeOctaneText');
    assertTextBlockHasShrinkToFitProps({ blocks, label: 'FuelSummaryCard gradeOctaneText' });
});

test('FuelSummaryCard ratingText carries shrink-to-fit props', () => {
    // The rating count "(N reviews)" text was removed in the redesign to
    // reduce visual clutter in the title row. We only need to guard the
    // numeric rating ("3.4") that sits next to the star icon now.
    const source = readSource(FUEL_SUMMARY_CARD_PATH);
    const ratingTextBlocks = findTextBlocksWithStyle(source, 'styles.ratingText');
    assertTextBlockHasShrinkToFitProps({ blocks: ratingTextBlocks, label: 'ratingText' });
});

test('FuelSummaryCard cardMeta (footer row) Text blocks carry shrink-to-fit props', () => {
    const source = readSource(FUEL_SUMMARY_CARD_PATH);
    const blocks = findTextBlocksWithStyle(source, 'styles.cardMeta');
    assertTextBlockHasShrinkToFitProps({ blocks, label: 'FuelSummaryCard cardMeta' });
});

// ============================================================================
// OnboardingScreen octane grade selector (4 horizontal buttons)
// ============================================================================

function buildOnboardingOctaneLayout() {
    const source = readSource(ONBOARDING_PATH);
    const octaneNumberFontSize = extractNumericStyle(source, 'octaneNumber', 'fontSize');
    const octaneLabelFontSize = extractNumericStyle(source, 'octaneLabel', 'fontSize');
    const octaneOptionsGap = extractNumericStyle(source, 'octaneOptions', 'gap');

    // The octane card uses a literal width formula
    // `(SCREEN_WIDTH - 96) / 3` inside the StyleSheet. Re-derive the same
    // expression at the iPhone 17 Pro viewport so the test stays aligned
    // with the real runtime value.
    const widthFormulaMatch = source.match(
        /octaneCard\s*:\s*\{[\s\S]*?width\s*:\s*\(SCREEN_WIDTH\s*-\s*(\d+)\)\s*\/\s*(\d+)[\s\S]*?\}/
    );
    if (!widthFormulaMatch) {
        throw new Error('Could not parse octaneCard.width formula in OnboardingScreen.js');
    }
    const widthSubtract = Number(widthFormulaMatch[1]);
    const widthDivide = Number(widthFormulaMatch[2]);
    const columnWidth = (IPHONE_17_PRO_WIDTH - widthSubtract) / widthDivide;

    // octaneCard has `paddingVertical: 24` and no horizontal padding, so
    // the usable text width equals the column width.
    const columnTextWidth = columnWidth;

    return {
        octaneNumberFontSize,
        octaneLabelFontSize,
        octaneOptionsGap,
        columnWidth,
        columnTextWidth,
    };
}

test('Onboarding octane grade cards load their layout constants', () => {
    const layout = buildOnboardingOctaneLayout();
    assert.ok(layout.octaneNumberFontSize > 0);
    assert.ok(layout.octaneLabelFontSize > 0);
    assert.ok(layout.columnWidth > 0);
    assert.ok(layout.columnTextWidth > 0);
});

test('Onboarding octane grade labels fit the card width', () => {
    const layout = buildOnboardingOctaneLayout();
    const failures = [];

    // The octane "numbers" are 2-3 chars ("87", "89", "91") plus the
    // edge case of "Diesel" which is displayed via `octaneNumber` slot
    // for the diesel card too (per the app's fuelGrade meta).
    const numberCandidates = ['87', '89', '91', '93', 'Diesel'];
    numberCandidates.forEach(text => {
        const measured = approximateTextWidth(text, layout.octaneNumberFontSize);
        if (measured > layout.columnTextWidth) {
            failures.push(
                `octaneNumber "${text}" -> ${formatWidth(measured)}pt > column text ${formatWidth(layout.columnTextWidth)}pt`
            );
        }
    });

    const labelCandidates = ['Regular', 'Midgrade', 'Premium', 'Diesel'];
    labelCandidates.forEach(text => {
        const measured = approximateTextWidth(text, layout.octaneLabelFontSize);
        if (measured > layout.columnTextWidth) {
            failures.push(
                `octaneLabel "${text}" -> ${formatWidth(measured)}pt > column text ${formatWidth(layout.columnTextWidth)}pt`
            );
        }
    });

    if (failures.length > 0) {
        assert.fail(
            `Onboarding octane selector would wrap on iPhone 17 Pro (${IPHONE_17_PRO_WIDTH}pt):\n  ` +
            failures.join('\n  ')
        );
    }
});

test('Onboarding octaneNumber + octaneLabel Text blocks carry shrink-to-fit props', () => {
    const source = readSource(ONBOARDING_PATH);
    const numberBlocks = findTextBlocksWithStyle(source, 'styles.octaneNumber');
    const labelBlocks = findTextBlocksWithStyle(source, 'styles.octaneLabel');
    assertTextBlockHasShrinkToFitProps({ blocks: numberBlocks, label: 'Onboarding octaneNumber' });
    assertTextBlockHasShrinkToFitProps({ blocks: labelBlocks, label: 'Onboarding octaneLabel' });
});

test('Onboarding demo chip + continue button Text carry shrink-to-fit props', () => {
    const source = readSource(ONBOARDING_PATH);
    const demoBlocks = findTextBlocksWithStyle(source, 'styles.demoChipText');
    const continueBlocks = findTextBlocksWithStyle(source, 'styles.continueText');
    assertTextBlockHasShrinkToFitProps({ blocks: demoBlocks, label: 'Onboarding demoChipText' });
    assertTextBlockHasShrinkToFitProps({ blocks: continueBlocks, label: 'Onboarding continueText' });
});

// ============================================================================
// Settings screen
//
// The settings screen now renders inside a native SwiftUI `Form` via
// `@expo/ui/swift-ui` (see `src/components/settings/NativeSettingsForm.js`),
// so the OS — not React Native — owns row layout, font sizing, and
// truncation. There are no React Native Text blocks to guard inside the
// form. We instead assert that the source uses native components and that
// the navigation app picker is wired to the new `navigationApp` preference.
// ============================================================================

const NATIVE_SETTINGS_FORM_PATH = path.join(
    REPO_ROOT,
    'src',
    'components',
    'settings',
    'NativeSettingsForm.js'
);

test('NativeSettingsForm uses @expo/ui SwiftUI primitives, not RN Text rows', () => {
    const source = readSource(NATIVE_SETTINGS_FORM_PATH);
    assert.ok(
        source.includes("from '@expo/ui/swift-ui'"),
        'NativeSettingsForm must import from @expo/ui/swift-ui so the rows are native SwiftUI'
    );
    assert.ok(
        /<Picker[\s\S]*selection=\{preferredOctane\}/.test(source),
        'NativeSettingsForm must hand preferredOctane to a native Picker'
    );
    assert.ok(
        /<Picker[\s\S]*selection=\{themeMode\}/.test(source),
        'NativeSettingsForm must hand themeMode to a native Picker'
    );
    assert.ok(
        /<Slider[\s\S]*onValueChange/.test(source),
        'NativeSettingsForm must use a native Slider for the search radius'
    );
});

test('NativeSettingsForm exposes the navigation-app picker', () => {
    const source = readSource(NATIVE_SETTINGS_FORM_PATH);
    assert.ok(
        /selection=\{navigationApp\}/.test(source),
        'NativeSettingsForm must wire `navigationApp` to its Picker selection'
    );
    assert.ok(
        source.includes('apple-maps') && source.includes('google-maps'),
        'NativeSettingsForm must offer Apple Maps and Google Maps as the two navigation app options'
    );
});

// ============================================================================
// Home screen Reload button (inside a compact horizontal button)
// ============================================================================

test('Home reload button Text carries shrink-to-fit props', () => {
    const source = readSource(HOME_SCREEN_PATH);
    const blocks = findTextBlocksWithStyle(source, 'styles.reloadButtonText');
    assertTextBlockHasShrinkToFitProps({ blocks, label: 'Home reloadButtonText' });
});
