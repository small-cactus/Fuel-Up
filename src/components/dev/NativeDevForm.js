import React, { useMemo, useState } from 'react';
import {
    Pressable,
    ScrollView,
    StyleSheet,
    Switch,
    Text,
    TextInput,
    View,
} from 'react-native';
import { SymbolView } from 'expo-symbols';

function SettingsGroup({ children, isDark }) {
    const childrenArray = React.Children.toArray(children).filter(Boolean);

    return (
        <View
            style={[
                styles.group,
                { backgroundColor: isDark ? '#1C1C1E' : '#FFFFFF' },
            ]}
        >
            {childrenArray.map((child, index) => (
                <View key={index}>
                    {child}
                    {index < childrenArray.length - 1 ? (
                        <View
                            style={[
                                styles.separator,
                                { backgroundColor: isDark ? 'rgba(84,84,88,0.65)' : 'rgba(60,60,67,0.18)' },
                            ]}
                        />
                    ) : null}
                </View>
            ))}
        </View>
    );
}

function SectionLabel({ children, isDark }) {
    return (
        <Text style={[styles.sectionLabel, { color: isDark ? 'rgba(235,235,245,0.6)' : 'rgba(60,60,67,0.6)' }]}>
            {children}
        </Text>
    );
}

function ValueText({ children, isDark, tone = 'default' }) {
    let color = isDark ? 'rgba(235,235,245,0.6)' : 'rgba(60,60,67,0.72)';
    if (tone === 'positive') {
        color = '#34C759';
    } else if (tone === 'warning') {
        color = '#FF9500';
    } else if (tone === 'danger') {
        color = '#FF3B30';
    }

    return (
        <Text style={[styles.rowValue, { color }]} numberOfLines={1}>
            {children}
        </Text>
    );
}

function SettingsRow({
    label,
    subtitle = null,
    value = null,
    onPress,
    isDark,
    destructive = false,
    disabled = false,
    tone = 'default',
    showChevron = null,
}) {
    const shouldShowChevron = showChevron == null ? typeof onPress === 'function' : showChevron;

    return (
        <Pressable
            onPress={onPress}
            disabled={!onPress || disabled}
            style={({ pressed }) => [
                styles.row,
                pressed && onPress && !disabled ? styles.rowPressed : null,
                disabled ? styles.rowDisabled : null,
            ]}
        >
            <View style={styles.rowTextBlock}>
                <Text
                    style={[
                        styles.rowLabel,
                        {
                            color: destructive
                                ? '#FF3B30'
                                : isDark
                                    ? '#FFFFFF'
                                    : '#000000',
                        },
                    ]}
                    numberOfLines={1}
                >
                    {label}
                </Text>
                {subtitle ? (
                    <Text style={[styles.rowSubtitle, { color: isDark ? 'rgba(235,235,245,0.6)' : 'rgba(60,60,67,0.6)' }]}>
                        {subtitle}
                    </Text>
                ) : null}
            </View>

            <View style={styles.rowAccessory}>
                {value != null ? (
                    <ValueText isDark={isDark} tone={tone}>
                        {value}
                    </ValueText>
                ) : null}
                {shouldShowChevron ? (
                    <SymbolView
                        name="chevron.right"
                        size={16}
                        tintColor={isDark ? 'rgba(235,235,245,0.3)' : 'rgba(60,60,67,0.35)'}
                    />
                ) : null}
            </View>
        </Pressable>
    );
}

function ToggleRow({
    label,
    subtitle = null,
    value,
    onValueChange,
    isDark,
}) {
    return (
        <View style={styles.row}>
            <View style={styles.rowTextBlock}>
                <Text style={[styles.rowLabel, { color: isDark ? '#FFFFFF' : '#000000' }]}>
                    {label}
                </Text>
                {subtitle ? (
                    <Text style={[styles.rowSubtitle, { color: isDark ? 'rgba(235,235,245,0.6)' : 'rgba(60,60,67,0.6)' }]}>
                        {subtitle}
                    </Text>
                ) : null}
            </View>
            <Switch
                value={value}
                onValueChange={onValueChange}
                trackColor={{ false: isDark ? '#3A3A3C' : '#D1D1D6', true: '#34C759' }}
                thumbColor="#FFFFFF"
                ios_backgroundColor={isDark ? '#3A3A3C' : '#D1D1D6'}
            />
        </View>
    );
}

function PageHeader({
    title,
    canGoBack,
    onBack,
    isDark,
}) {
    return (
        <View style={styles.pageHeader}>
            {canGoBack ? (
                <Pressable onPress={onBack} style={({ pressed }) => [styles.backButton, pressed ? styles.rowPressed : null]}>
                    <SymbolView
                        name="chevron.left"
                        size={16}
                        tintColor="#007AFF"
                    />
                    <Text style={styles.backText}>Dev</Text>
                </Pressable>
            ) : (
                <View style={styles.backPlaceholder} />
            )}
            <Text style={[styles.pageTitle, { color: isDark ? '#FFFFFF' : '#000000' }]}>
                {title}
            </Text>
            <View style={styles.backPlaceholder} />
        </View>
    );
}

function InputPanel({
    title,
    value,
    onChangeText,
    placeholder,
    multiline = false,
    isDark,
}) {
    return (
        <View style={styles.inputPanelWrap}>
            <SectionLabel isDark={isDark}>{title}</SectionLabel>
            <View
                style={[
                    styles.inputPanel,
                    { backgroundColor: isDark ? '#1C1C1E' : '#FFFFFF' },
                    multiline ? styles.inputPanelLarge : null,
                ]}
            >
                <TextInput
                    value={value}
                    onChangeText={onChangeText}
                    placeholder={placeholder}
                    placeholderTextColor={isDark ? 'rgba(235,235,245,0.35)' : 'rgba(60,60,67,0.35)'}
                    multiline={multiline}
                    textAlignVertical={multiline ? 'top' : 'center'}
                    style={[
                        styles.input,
                        { color: isDark ? '#FFFFFF' : '#000000' },
                        multiline ? styles.inputMultiline : null,
                    ]}
                />
            </View>
        </View>
    );
}

function NoteBlock({ children, isDark }) {
    return (
        <Text style={[styles.noteText, { color: isDark ? 'rgba(235,235,245,0.6)' : 'rgba(60,60,67,0.6)' }]}>
            {children}
        </Text>
    );
}

function SelectionPage({
    title,
    options,
    selectedKey,
    onSelect,
    isDark,
}) {
    return (
        <>
            <SectionLabel isDark={isDark}>{title}</SectionLabel>
            <SettingsGroup isDark={isDark}>
                {options.map(option => (
                    <Pressable
                        key={String(option.key)}
                        onPress={() => onSelect(option.key)}
                        style={({ pressed }) => [styles.row, pressed ? styles.rowPressed : null]}
                    >
                        <Text style={[styles.rowLabel, { color: isDark ? '#FFFFFF' : '#000000' }]}>
                            {option.label}
                        </Text>
                        {selectedKey === option.key ? (
                            <SymbolView name="checkmark" size={18} tintColor="#007AFF" />
                        ) : null}
                    </Pressable>
                ))}
            </SettingsGroup>
        </>
    );
}

function buildSummaryMap({ predictive, analysis, notifications, simulation, maintenance }) {
    const findLabel = (options, key) => options.find(option => option.key === key)?.label || '';
    const routeLabel = findLabel(predictive.routeOptions, predictive.selectedRouteId).split(' · ')[0] || 'Route';

    return {
        maintenance: maintenance.clusterDebugEnabled ? 'Debug On' : 'Debug Off',
        notifications: notifications.liveActivityActive ? 'Activity Active' : 'Push & Live Activities',
        predictive: routeLabel,
        analysis: analysis.stationScores.length ? `${analysis.stationScores.length} Stations` : 'No Data',
        model: findLabel(analysis.predictionModeOptions, analysis.predictionMode) || 'Heuristic',
        scenario: findLabel(simulation.profileOptions, simulation.selectedProfileId) || 'Balanced',
        backgroundFetch: findLabel(simulation.fetchNetworkOptions, simulation.fetchNetworkCondition) || 'Good',
    };
}

function buildTriggerEntries(analysis) {
    return analysis.triggerLog.map(entry => (
        `${entry.time}  ${analysis.stationNameForId(entry.stationId)}  ${entry.confidence}`
    ));
}

export default function NativeDevForm({
    isDark,
    maintenance,
    notifications,
    predictive,
    analysis,
    simulation,
}) {
    const [pageStack, setPageStack] = useState([{ key: 'main', title: 'Developer' }]);
    const currentPage = pageStack[pageStack.length - 1];
    const summaries = useMemo(() => (
        buildSummaryMap({ predictive, analysis, notifications, simulation, maintenance })
    ), [analysis, maintenance, notifications, predictive, simulation]);

    const pushPage = (key, title) => {
        setPageStack(current => [...current, { key, title }]);
    };

    const popPage = () => {
        setPageStack(current => (current.length > 1 ? current.slice(0, -1) : current));
    };

    const selectAndGoBack = (setter) => (nextValue) => {
        setter(nextValue);
        popPage();
    };

    const renderMainPage = () => (
        <>
            <SectionLabel isDark={isDark}>Developer Tools</SectionLabel>
            <SettingsGroup isDark={isDark}>
                <SettingsRow label="Maintenance" value={summaries.maintenance} onPress={() => pushPage('maintenance', 'Maintenance')} isDark={isDark} />
                <SettingsRow label="Notifications" value={summaries.notifications} onPress={() => pushPage('notifications', 'Notifications')} isDark={isDark} />
            </SettingsGroup>

            <SectionLabel isDark={isDark}>Predictive</SectionLabel>
            <SettingsGroup isDark={isDark}>
                <SettingsRow label="Predictive Playback" value={summaries.predictive} onPress={() => pushPage('predictive', 'Predictive Playback')} isDark={isDark} />
                <SettingsRow label="Analysis" value={summaries.analysis} onPress={() => pushPage('analysis', 'Analysis')} isDark={isDark} />
                <SettingsRow label="Model Tuning" value={summaries.model} onPress={() => pushPage('model', 'Model Tuning')} isDark={isDark} />
            </SettingsGroup>

            <SectionLabel isDark={isDark}>Simulation</SectionLabel>
            <SettingsGroup isDark={isDark}>
                <SettingsRow label="Scenario Lab" value={summaries.scenario} onPress={() => pushPage('scenario', 'Scenario Lab')} isDark={isDark} />
                <SettingsRow label="Background Fetch" value={summaries.backgroundFetch} onPress={() => pushPage('background-fetch', 'Background Fetch')} isDark={isDark} />
            </SettingsGroup>
        </>
    );

    const renderMaintenancePage = () => (
        <>
            <SectionLabel isDark={isDark}>Fuel Refresh</SectionLabel>
            <SettingsGroup isDark={isDark}>
                <SettingsRow
                    label="Run Hourly Fuel Refresh"
                    value={maintenance.isRefreshingFuel ? 'Running' : null}
                    onPress={maintenance.isRefreshingFuel ? undefined : maintenance.onRunHourlyRefreshPath}
                    isDark={isDark}
                    showChevron={false}
                    disabled={maintenance.isRefreshingFuel}
                />
            </SettingsGroup>

            <SectionLabel isDark={isDark}>API Counters</SectionLabel>
            <SettingsGroup isDark={isDark}>
                {maintenance.apiCounterRows.map(counter => (
                    <SettingsRow
                        key={counter.key}
                        label={counter.label}
                        value={String(counter.value)}
                        isDark={isDark}
                        showChevron={false}
                    />
                ))}
                <SettingsRow
                    label="Reset API Counters"
                    onPress={maintenance.onResetCounters}
                    isDark={isDark}
                    showChevron={false}
                />
            </SettingsGroup>

            <SectionLabel isDark={isDark}>Cluster Diagnostics</SectionLabel>
            <SettingsGroup isDark={isDark}>
                <ToggleRow
                    label="Cluster Debug Overlay"
                    subtitle="Show the home-map diagnostic overlay for cluster handoff work."
                    value={maintenance.clusterDebugEnabled}
                    onValueChange={maintenance.onSetClusterDebugEnabled}
                    isDark={isDark}
                />
            </SettingsGroup>
        </>
    );

    const renderNotificationsPage = () => (
        <>
            <SectionLabel isDark={isDark}>Messaging</SectionLabel>
            <SettingsGroup isDark={isDark}>
                <SettingsRow
                    label="Local Push Composer"
                    value={notifications.testTitle || 'Untitled'}
                    onPress={() => pushPage('push-composer', 'Local Push Composer')}
                    isDark={isDark}
                />
                <SettingsRow
                    label="Live Activities"
                    value={notifications.liveActivityActive ? 'Active' : 'Idle'}
                    onPress={() => pushPage('live-activities', 'Live Activities')}
                    isDark={isDark}
                    tone={notifications.liveActivityActive ? 'positive' : 'default'}
                />
            </SettingsGroup>
        </>
    );

    const renderPushComposerPage = () => (
        <>
            <InputPanel
                title="Title"
                value={notifications.testTitle}
                onChangeText={notifications.onChangeTitle}
                placeholder="Test Push"
                isDark={isDark}
            />
            <InputPanel
                title="Body"
                value={notifications.testBody}
                onChangeText={notifications.onChangeBody}
                placeholder="This is a local push notification test."
                multiline
                isDark={isDark}
            />

            <SectionLabel isDark={isDark}>Actions</SectionLabel>
            <SettingsGroup isDark={isDark}>
                <SettingsRow label="Send Local Push Now" onPress={notifications.onSendNow} isDark={isDark} showChevron={false} />
                <SettingsRow label="Send in 5 Seconds" onPress={notifications.onSendDelayed} isDark={isDark} showChevron={false} />
            </SettingsGroup>
        </>
    );

    const renderLiveActivitiesPage = () => (
        <>
            <SectionLabel isDark={isDark}>Status</SectionLabel>
            <SettingsGroup isDark={isDark}>
                <SettingsRow
                    label="Current State"
                    value={notifications.liveActivityActive ? 'Active' : 'Idle'}
                    isDark={isDark}
                    tone={notifications.liveActivityActive ? 'positive' : 'default'}
                    showChevron={false}
                />
            </SettingsGroup>

            <SectionLabel isDark={isDark}>Actions</SectionLabel>
            <SettingsGroup isDark={isDark}>
                <SettingsRow label="Start Price Drop Activity" onPress={notifications.onStartLiveActivity} isDark={isDark} showChevron={false} />
                <SettingsRow
                    label="Update to $2.85"
                    onPress={notifications.liveActivityActive ? notifications.onUpdateLiveActivity : undefined}
                    isDark={isDark}
                    showChevron={false}
                    disabled={!notifications.liveActivityActive}
                />
                <SettingsRow
                    label="End Activity"
                    onPress={notifications.liveActivityActive ? notifications.onEndLiveActivity : undefined}
                    isDark={isDark}
                    showChevron={false}
                    destructive
                    disabled={!notifications.liveActivityActive}
                />
            </SettingsGroup>
        </>
    );

    const renderPredictivePage = () => (
        <>
            <SectionLabel isDark={isDark}>Configuration</SectionLabel>
            <SettingsGroup isDark={isDark}>
                <SettingsRow
                    label="Route"
                    value={predictive.routeOptions.find(option => option.key === predictive.selectedRouteId)?.label || 'Route'}
                    onPress={() => pushPage('select-route', 'Route')}
                    isDark={isDark}
                />
                <SettingsRow
                    label="Playback Speed"
                    value={predictive.speedOptions.find(option => option.key === predictive.speedMult)?.label || '10x'}
                    onPress={() => pushPage('select-speed', 'Playback Speed')}
                    isDark={isDark}
                />
            </SettingsGroup>

            <SectionLabel isDark={isDark}>Status</SectionLabel>
            <SettingsGroup isDark={isDark}>
                <SettingsRow
                    label="Progress"
                    value={predictive.harnessPhase === 'complete'
                        ? 'Complete'
                        : `${predictive.harnessStep} / ${predictive.harnessTotal || 0}`}
                    isDark={isDark}
                    showChevron={false}
                />
                <SettingsRow
                    label="State"
                    value={predictive.harnessPhase}
                    isDark={isDark}
                    showChevron={false}
                    tone={predictive.harnessPhase === 'complete' ? 'positive' : 'default'}
                />
            </SettingsGroup>

            <SectionLabel isDark={isDark}>Playback</SectionLabel>
            <SettingsGroup isDark={isDark}>
                <SettingsRow
                    label="Play Route"
                    onPress={predictive.harnessPhase === 'playing' ? undefined : predictive.onPlay}
                    isDark={isDark}
                    showChevron={false}
                    disabled={predictive.harnessPhase === 'playing'}
                />
                <SettingsRow
                    label="Pause Playback"
                    onPress={predictive.harnessPhase === 'playing' ? predictive.onPause : undefined}
                    isDark={isDark}
                    showChevron={false}
                    disabled={predictive.harnessPhase !== 'playing'}
                />
                <SettingsRow
                    label="Reset Harness"
                    onPress={predictive.onReset}
                    isDark={isDark}
                    showChevron={false}
                />
            </SettingsGroup>
        </>
    );

    const renderAnalysisPage = () => (
        <>
            <SectionLabel isDark={isDark}>Live Confidence</SectionLabel>
            <SettingsGroup isDark={isDark}>
                {analysis.stationScores.length ? analysis.stationScores.map(score => (
                    <SettingsRow
                        key={score.stationId}
                        label={analysis.stationNameForId(score.stationId)}
                        value={`${Math.round(score.confidence * 100)}%`}
                        isDark={isDark}
                        tone={
                            score.confidence >= 0.72
                                ? 'positive'
                                : score.confidence >= 0.45
                                    ? 'warning'
                                    : 'default'
                        }
                        showChevron={false}
                    />
                )) : (
                    <SettingsRow label="No live confidence data yet" isDark={isDark} showChevron={false} />
                )}
            </SettingsGroup>

            {analysis.triggerLog.length ? (
                <>
                    <SectionLabel isDark={isDark}>Recent Triggers</SectionLabel>
                    <SettingsGroup isDark={isDark}>
                        {buildTriggerEntries(analysis).map((entry, index) => (
                            <SettingsRow key={`${entry}-${index}`} label={entry} isDark={isDark} showChevron={false} />
                        ))}
                    </SettingsGroup>
                </>
            ) : null}

            <SectionLabel isDark={isDark}>Batch Accuracy</SectionLabel>
            <SettingsGroup isDark={isDark}>
                <SettingsRow
                    label={`Run All ${analysis.batchRouteCount} Routes`}
                    value={analysis.isBatchRunning ? 'Running' : null}
                    onPress={analysis.isBatchRunning ? undefined : analysis.onRunBatch}
                    isDark={isDark}
                    showChevron={false}
                    disabled={analysis.isBatchRunning}
                />
                {analysis.batchResults ? (
                    <>
                        <SettingsRow
                            label="Accuracy"
                            value={`${analysis.batchResults.correctPredictions}/${analysis.batchResults.totalRoutes} (${analysis.batchResults.accuracyPercent}%)`}
                            isDark={isDark}
                            tone="positive"
                            showChevron={false}
                        />
                        <SettingsRow
                            label="False Positives"
                            value={String(analysis.batchResults.falsePositives)}
                            isDark={isDark}
                            tone="warning"
                            showChevron={false}
                        />
                        <SettingsRow
                            label="False Negatives"
                            value={String(analysis.batchResults.falseNegatives)}
                            isDark={isDark}
                            tone="danger"
                            showChevron={false}
                        />
                    </>
                ) : null}
            </SettingsGroup>
        </>
    );

    const renderModelPage = () => (
        <>
            <SectionLabel isDark={isDark}>Configuration</SectionLabel>
            <SettingsGroup isDark={isDark}>
                <SettingsRow
                    label="Prediction Mode"
                    value={analysis.predictionModeOptions.find(option => option.key === analysis.predictionMode)?.label || 'Heuristic'}
                    onPress={() => pushPage('select-prediction-mode', 'Prediction Mode')}
                    isDark={isDark}
                />
            </SettingsGroup>

            <SectionLabel isDark={isDark}>Actions</SectionLabel>
            <SettingsGroup isDark={isDark}>
                {analysis.predictionMode === 'ml' ? (
                    <SettingsRow
                        label={
                            analysis.mlStatus === 'training'
                                ? 'Training Model'
                                : analysis.mlStatus === 'trained'
                                    ? 'Retrain Model'
                                    : 'Train Model'
                        }
                        value={analysis.mlStatus === 'training' ? 'Working' : null}
                        onPress={analysis.mlStatus === 'training' ? undefined : analysis.onTrainModel}
                        isDark={isDark}
                        showChevron={false}
                        disabled={analysis.mlStatus === 'training'}
                    />
                ) : null}
                <SettingsRow
                    label="Grid Search Parameters"
                    value={analysis.isGridSearching ? 'Running' : null}
                    onPress={analysis.isGridSearching ? undefined : analysis.onRunGridSearch}
                    isDark={isDark}
                    showChevron={false}
                    disabled={analysis.isGridSearching}
                />
            </SettingsGroup>

            {(analysis.heuristicPRF1 && analysis.mlMetrics) || analysis.gridSearchResults?.best ? (
                <>
                    <SectionLabel isDark={isDark}>Results</SectionLabel>
                    <SettingsGroup isDark={isDark}>
                        {analysis.heuristicPRF1 && analysis.mlMetrics ? (
                            <>
                                <SettingsRow label="Precision" value={`H ${analysis.heuristicPRF1.precision} · ML ${analysis.mlMetrics.precision}`} isDark={isDark} showChevron={false} />
                                <SettingsRow label="Recall" value={`H ${analysis.heuristicPRF1.recall} · ML ${analysis.mlMetrics.recall}`} isDark={isDark} showChevron={false} />
                                <SettingsRow label="F1" value={`H ${analysis.heuristicPRF1.f1} · ML ${analysis.mlMetrics.f1}`} isDark={isDark} showChevron={false} />
                                <SettingsRow label="Accuracy" value={`H ${analysis.heuristicPRF1.accuracy}% · ML ${analysis.mlMetrics.accuracy}%`} isDark={isDark} showChevron={false} />
                            </>
                        ) : null}
                        {analysis.mlMetrics?.trainingLog?.length ? (
                            <SettingsRow
                                label="Training Summary"
                                value={`${analysis.mlMetrics.trainingAccuracy}% · loss ${analysis.mlMetrics.trainingLog[analysis.mlMetrics.trainingLog.length - 1].loss}`}
                                isDark={isDark}
                                showChevron={false}
                            />
                        ) : null}
                        {analysis.gridSearchResults?.best ? (
                            <>
                                <SettingsRow label="Best Threshold" value={String(analysis.gridSearchResults.best.params.threshold)} isDark={isDark} showChevron={false} />
                                <SettingsRow label="Window Size" value={String(analysis.gridSearchResults.best.params.windowSize)} isDark={isDark} showChevron={false} />
                                <SettingsRow label="Bearing Weight" value={String(analysis.gridSearchResults.best.params.bearingWeight)} isDark={isDark} showChevron={false} />
                            </>
                        ) : null}
                    </SettingsGroup>
                </>
            ) : null}
        </>
    );

    const renderScenarioPage = () => (
        <>
            <SectionLabel isDark={isDark}>Scenario Inputs</SectionLabel>
            <SettingsGroup isDark={isDark}>
                <SettingsRow
                    label="User Profile"
                    value={simulation.profileOptions.find(option => option.key === simulation.selectedProfileId)?.label || 'Balanced'}
                    onPress={() => pushPage('select-profile', 'User Profile')}
                    isDark={isDark}
                />
                <SettingsRow
                    label="Fill-Up History"
                    value={simulation.fillUpHistoryOptions.find(option => option.key === simulation.fillUpHistoryKey)?.label || 'frequent filler'}
                    onPress={() => pushPage('select-history', 'Fill-Up History')}
                    isDark={isDark}
                />
                <ToggleRow
                    label="Expanded Routes"
                    subtitle="Use the larger route set for training and simulation."
                    value={simulation.useExpandedRoutes}
                    onValueChange={simulation.onSetUseExpandedRoutes}
                    isDark={isDark}
                />
            </SettingsGroup>

            {simulation.selectedProfileDescription ? (
                <NoteBlock isDark={isDark}>
                    {simulation.selectedProfileDescription}
                </NoteBlock>
            ) : null}

            <SectionLabel isDark={isDark}>Range</SectionLabel>
            <SettingsGroup isDark={isDark}>
                <SettingsRow
                    label="Estimate Range"
                    onPress={simulation.onEstimateRange}
                    isDark={isDark}
                    showChevron={false}
                />
                {simulation.rangeResult ? (
                    <>
                        <SettingsRow label="Urgency" value={simulation.rangeResult.urgency} isDark={isDark} showChevron={false} tone={simulation.rangeResult.urgent ? 'danger' : simulation.rangeResult.lowFuel ? 'warning' : 'positive'} />
                        <SettingsRow label="Summary" value={simulation.rangeSummary} isDark={isDark} showChevron={false} />
                        <SettingsRow label="Avg Interval" value={`${simulation.rangeResult.avgIntervalMiles} mi`} isDark={isDark} showChevron={false} />
                        <SettingsRow label="Since Fill" value={simulation.rangeResult.milesSinceLastFill == null ? 'Unknown' : `${simulation.rangeResult.milesSinceLastFill} mi`} isDark={isDark} showChevron={false} />
                    </>
                ) : null}
            </SettingsGroup>
        </>
    );

    const renderBackgroundFetchPage = () => (
        <>
            <SectionLabel isDark={isDark}>Configuration</SectionLabel>
            <SettingsGroup isDark={isDark}>
                <SettingsRow
                    label="Network"
                    value={simulation.fetchNetworkOptions.find(option => option.key === simulation.fetchNetworkCondition)?.label || 'Good'}
                    onPress={() => pushPage('select-network', 'Network')}
                    isDark={isDark}
                />
                <SettingsRow
                    label="Fetch Interval"
                    value={simulation.fetchIntervalOptions.find(option => option.key === simulation.fetchIntervalKey)?.label || 'Moderate'}
                    onPress={() => pushPage('select-interval', 'Fetch Interval')}
                    isDark={isDark}
                />
            </SettingsGroup>

            <SectionLabel isDark={isDark}>Simulation</SectionLabel>
            <SettingsGroup isDark={isDark}>
                <SettingsRow label="Run 30 Minute Simulation" onPress={simulation.onRunFetchSimulation} isDark={isDark} showChevron={false} />
                <SettingsRow label="Reset Background Fetch" onPress={simulation.onResetFetchSimulation} isDark={isDark} showChevron={false} />
            </SettingsGroup>

            {simulation.fetchStats ? (
                <>
                    <SectionLabel isDark={isDark}>Telemetry</SectionLabel>
                    <SettingsGroup isDark={isDark}>
                        <SettingsRow label="Fetches" value={String(simulation.fetchStats.fetchesAttempted)} isDark={isDark} showChevron={false} />
                        <SettingsRow label="Succeeded" value={String(simulation.fetchStats.fetchesSucceeded)} isDark={isDark} tone="positive" showChevron={false} />
                        <SettingsRow label="Success Rate" value={`${simulation.fetchStats.successRate}%`} isDark={isDark} tone={simulation.fetchStats.successRate >= 80 ? 'positive' : 'warning'} showChevron={false} />
                        <SettingsRow label="Data Used" value={`${simulation.fetchStats.totalDataKB} KB`} isDark={isDark} showChevron={false} />
                        <SettingsRow label="Battery" value={`${simulation.fetchStats.estimatedBatteryMah} mAh`} isDark={isDark} showChevron={false} />
                        <SettingsRow label="Price Changes" value={String(simulation.fetchStats.priceChangesDetected)} isDark={isDark} tone="warning" showChevron={false} />
                        <SettingsRow label="Stations Offline" value={String(simulation.fetchStats.stationsWentOffline)} isDark={isDark} tone="danger" showChevron={false} />
                    </SettingsGroup>
                </>
            ) : null}

            {simulation.fetchLog.length ? (
                <>
                    <SectionLabel isDark={isDark}>Event Log</SectionLabel>
                    <SettingsGroup isDark={isDark}>
                        {simulation.fetchLog.map((entry, index) => (
                            <SettingsRow key={`${entry}-${index}`} label={entry} isDark={isDark} showChevron={false} />
                        ))}
                    </SettingsGroup>
                </>
            ) : null}
        </>
    );

    const renderCurrentPage = () => {
        switch (currentPage.key) {
            case 'main':
                return renderMainPage();
            case 'maintenance':
                return renderMaintenancePage();
            case 'notifications':
                return renderNotificationsPage();
            case 'push-composer':
                return renderPushComposerPage();
            case 'live-activities':
                return renderLiveActivitiesPage();
            case 'predictive':
                return renderPredictivePage();
            case 'analysis':
                return renderAnalysisPage();
            case 'model':
                return renderModelPage();
            case 'scenario':
                return renderScenarioPage();
            case 'background-fetch':
                return renderBackgroundFetchPage();
            case 'select-route':
                return (
                    <SelectionPage
                        title="Choose a Route"
                        options={predictive.routeOptions}
                        selectedKey={predictive.selectedRouteId}
                        onSelect={selectAndGoBack(predictive.onSelectRoute)}
                        isDark={isDark}
                    />
                );
            case 'select-speed':
                return (
                    <SelectionPage
                        title="Choose a Playback Speed"
                        options={predictive.speedOptions}
                        selectedKey={predictive.speedMult}
                        onSelect={selectAndGoBack(predictive.onSelectSpeed)}
                        isDark={isDark}
                    />
                );
            case 'select-prediction-mode':
                return (
                    <SelectionPage
                        title="Choose a Prediction Mode"
                        options={analysis.predictionModeOptions}
                        selectedKey={analysis.predictionMode}
                        onSelect={selectAndGoBack(analysis.onSetPredictionMode)}
                        isDark={isDark}
                    />
                );
            case 'select-profile':
                return (
                    <SelectionPage
                        title="Choose a User Profile"
                        options={simulation.profileOptions}
                        selectedKey={simulation.selectedProfileId}
                        onSelect={selectAndGoBack(simulation.onSelectProfile)}
                        isDark={isDark}
                    />
                );
            case 'select-history':
                return (
                    <SelectionPage
                        title="Choose a Fill-Up History"
                        options={simulation.fillUpHistoryOptions}
                        selectedKey={simulation.fillUpHistoryKey}
                        onSelect={selectAndGoBack(simulation.onSelectFillUpHistory)}
                        isDark={isDark}
                    />
                );
            case 'select-network':
                return (
                    <SelectionPage
                        title="Choose a Network Profile"
                        options={simulation.fetchNetworkOptions}
                        selectedKey={simulation.fetchNetworkCondition}
                        onSelect={selectAndGoBack(simulation.onSelectFetchNetwork)}
                        isDark={isDark}
                    />
                );
            case 'select-interval':
                return (
                    <SelectionPage
                        title="Choose a Fetch Interval"
                        options={simulation.fetchIntervalOptions}
                        selectedKey={simulation.fetchIntervalKey}
                        onSelect={selectAndGoBack(simulation.onSelectFetchInterval)}
                        isDark={isDark}
                    />
                );
            default:
                return renderMainPage();
        }
    };

    return (
        <ScrollView
            style={styles.container}
            contentContainerStyle={styles.contentContainer}
            showsVerticalScrollIndicator={false}
        >
            <PageHeader
                title={currentPage.title}
                canGoBack={pageStack.length > 1}
                onBack={popPage}
                isDark={isDark}
            />
            {renderCurrentPage()}
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    contentContainer: {
        paddingHorizontal: 16,
        paddingBottom: 44,
    },
    pageHeader: {
        minHeight: 46,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 14,
    },
    backButton: {
        minWidth: 64,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 2,
    },
    backPlaceholder: {
        minWidth: 64,
    },
    backText: {
        color: '#007AFF',
        fontSize: 17,
        fontWeight: '400',
    },
    pageTitle: {
        fontSize: 17,
        fontWeight: '600',
    },
    sectionLabel: {
        fontSize: 13,
        fontWeight: '400',
        marginLeft: 16,
        marginTop: 18,
        marginBottom: 8,
    },
    group: {
        borderRadius: 22,
        overflow: 'hidden',
    },
    row: {
        minHeight: 58,
        paddingHorizontal: 18,
        paddingVertical: 14,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 14,
    },
    rowPressed: {
        opacity: 0.72,
    },
    rowDisabled: {
        opacity: 0.45,
    },
    rowTextBlock: {
        flex: 1,
        gap: 4,
    },
    rowLabel: {
        fontSize: 17,
        fontWeight: '400',
    },
    rowSubtitle: {
        fontSize: 13,
        lineHeight: 17,
    },
    rowAccessory: {
        maxWidth: '48%',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'flex-end',
        gap: 8,
    },
    rowValue: {
        fontSize: 17,
        fontWeight: '400',
        textAlign: 'right',
    },
    separator: {
        height: StyleSheet.hairlineWidth,
        marginLeft: 18,
    },
    inputPanelWrap: {
        marginTop: 6,
    },
    inputPanel: {
        borderRadius: 22,
        paddingHorizontal: 18,
        paddingVertical: 14,
    },
    inputPanelLarge: {
        minHeight: 112,
    },
    input: {
        fontSize: 17,
        fontWeight: '400',
        minHeight: 24,
        padding: 0,
    },
    inputMultiline: {
        minHeight: 72,
    },
    noteText: {
        fontSize: 13,
        lineHeight: 18,
        marginTop: 10,
        marginHorizontal: 16,
    },
});
