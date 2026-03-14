import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { GlassContainer, GlassView } from 'expo-glass-effect';

function formatNumber(value, digits = 2) {
    if (typeof value !== 'number' || Number.isNaN(value)) {
        return '--';
    }

    return value.toFixed(digits);
}

function formatMove(move) {
    if (!move) {
        return '--';
    }

    return `dx ${formatNumber(move.dx)} | dy ${formatNumber(move.dy)}`;
}

function formatCoordinate(latitude, longitude) {
    if (typeof latitude !== 'number' || typeof longitude !== 'number') {
        return '--';
    }

    return `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
}

function formatClusterLabel(cluster) {
    if (!cluster?.quotes?.length) {
        return 'Nearest Cluster';
    }

    const [firstQuote, secondQuote] = cluster.quotes;
    const remainingCount = Math.max(0, cluster.quotes.length - 2);
    const base = [firstQuote?.stationId, secondQuote?.stationId].filter(Boolean).join(' • ');

    if (remainingCount <= 0) {
        return base || 'Nearest Cluster';
    }

    return `${base} +${remainingCount}`;
}

function Row({ label, value, themeColors }) {
    return (
        <View style={styles.row}>
            <Text style={[styles.rowLabel, { color: themeColors.text }]}>{label}</Text>
            <Text style={[styles.rowValue, { color: themeColors.text }]}>{value}</Text>
        </View>
    );
}

export default function ClusterDebugCard({
    diagnostic,
    cluster,
    isDark,
    isRecording,
    isProbeRunning,
    onStartRecording,
    onStopRecording,
    onRunProbe,
    probeSummary = '',
    themeColors,
}) {
    const hasDiagnostic = Boolean(diagnostic && cluster);
    const title = hasDiagnostic ? formatClusterLabel(cluster) : 'Nearest Cluster';
    const isBusy = isRecording || isProbeRunning;

    return (
        <GlassContainer spacing={0} style={styles.cardGroup}>
            <GlassView
                style={styles.card}
                tintColor={isDark ? '#000000' : '#FFFFFF'}
                glassEffectStyle={{
                    style: 'regular',
                    animate: true,
                    animationDuration: 0.2,
                }}
                key={isDark ? 'cluster-debug-dark' : 'cluster-debug-light'}
            >
                <Text style={[styles.title, { color: themeColors.text }]} numberOfLines={1}>
                    {title}
                </Text>

                {hasDiagnostic ? (
                    <>
                        <Text style={[styles.summary, { color: themeColors.text }]}>
                            {diagnostic.summary}
                        </Text>

                        <Row
                            label="State"
                            value={`s ${formatNumber(diagnostic.currentResolvedSpread)} -> ${formatNumber(diagnostic.nextMountSpread)} -> ${formatNumber(diagnostic.nextResolvedSpread)} | m ${formatNumber(diagnostic.currentResolvedMorph)} -> ${formatNumber(diagnostic.nextMountMorph)} -> ${formatNumber(diagnostic.nextResolvedMorph)}`}
                            themeColors={themeColors}
                        />
                        <Row
                            label="Switch"
                            value={`p ${formatNumber(diagnostic.primarySwitchDistance)}pt | s ${formatNumber(diagnostic.secondarySwitchDistance)}pt | w ${formatNumber(diagnostic.shellWidthDelta)}pt`}
                            themeColors={themeColors}
                        />
                        <Row
                            label="Center"
                            value={`${formatNumber(diagnostic.centerShiftDistance)}pt | ${formatCoordinate(diagnostic.nextContainerCenter.latitude, diagnostic.nextContainerCenter.longitude)}`}
                            themeColors={themeColors}
                        />
                        <Row
                            label="Move"
                            value={`p ${formatMove(diagnostic.plannedPrimaryMove)} | s ${formatMove(diagnostic.plannedSecondaryMove)}`}
                            themeColors={themeColors}
                        />
                        <Text style={[styles.footnote, { color: themeColors.text }]}>
                            {isProbeRunning
                                ? 'Running a live zoom probe. The map will animate, record, then emit one report.'
                                : isRecording
                                ? 'Recording samples. Stop to emit one summary log.'
                                : 'Use Record to capture samples, then Stop to emit one summary log.'}
                        </Text>
                        {probeSummary ? (
                            <Text style={[styles.footnote, { color: themeColors.text }]}>
                                {probeSummary}
                            </Text>
                        ) : null}
                    </>
                ) : (
                    <Text style={[styles.summary, { color: themeColors.text }]}>
                        No clustered marker is near the map center. Move the map until a multi-station cluster is near center to inspect its handoff.
                    </Text>
                )}

                <View style={styles.actionRow}>
                    <Pressable
                        disabled={isBusy}
                        onPress={onStartRecording}
                        style={[
                            styles.actionButton,
                            styles.recordButton,
                            isBusy && styles.actionButtonDisabled,
                        ]}
                    >
                        <Text style={styles.actionButtonText}>Record</Text>
                    </Pressable>
                    <Pressable
                        disabled={!isRecording || isProbeRunning}
                        onPress={onStopRecording}
                        style={[
                            styles.actionButton,
                            styles.stopButton,
                            (!isRecording || isProbeRunning) && styles.actionButtonDisabled,
                        ]}
                    >
                        <Text style={styles.actionButtonText}>Stop</Text>
                    </Pressable>
                    <Pressable
                        disabled={!hasDiagnostic || isBusy}
                        onPress={onRunProbe}
                        style={[
                            styles.actionButton,
                            styles.probeButton,
                            (!hasDiagnostic || isBusy) && styles.actionButtonDisabled,
                        ]}
                    >
                        <Text style={styles.actionButtonText}>
                            {isProbeRunning ? 'Running' : 'Probe'}
                        </Text>
                    </Pressable>
                </View>
            </GlassView>
        </GlassContainer>
    );
}

const styles = StyleSheet.create({
    cardGroup: {
        width: '100%',
    },
    card: {
        padding: 18,
        borderRadius: 32,
        overflow: 'hidden',
        gap: 10,
    },
    title: {
        fontSize: 16,
        fontWeight: '800',
    },
    summary: {
        fontSize: 12,
        lineHeight: 17,
        opacity: 0.88,
    },
    row: {
        gap: 1,
    },
    rowLabel: {
        fontSize: 10,
        fontWeight: '700',
        opacity: 0.7,
    },
    rowValue: {
        fontSize: 11,
        lineHeight: 15,
        fontWeight: '500',
    },
    footnote: {
        fontSize: 10,
        lineHeight: 14,
        opacity: 0.7,
    },
    actionRow: {
        flexDirection: 'row',
        gap: 10,
        marginTop: 2,
    },
    actionButton: {
        flex: 1,
        minHeight: 36,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
    },
    recordButton: {
        backgroundColor: '#34C759',
    },
    stopButton: {
        backgroundColor: '#FF3B30',
    },
    probeButton: {
        backgroundColor: '#007AFF',
    },
    actionButtonDisabled: {
        opacity: 0.35,
    },
    actionButtonText: {
        color: '#FFFFFF',
        fontSize: 12,
        fontWeight: '800',
    },
});
