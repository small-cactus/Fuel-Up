import React from 'react';
import { View } from 'react-native';
import Svg, { Path, Defs, LinearGradient as SvgLinearGradient, Stop } from 'react-native-svg';
import * as d3Shape from 'd3-shape';
import * as d3Scale from 'd3-scale';

export default function ObservedPriceChart({ data, width, height, trendColor, topBleed = 40 }) {
    if (!data || data.length === 0) return null;

    const margin = { top: topBleed, right: 0, bottom: 0, left: 0 };
    const chartWidth = width - margin.left - margin.right;
    const chartHeight = height - margin.top - margin.bottom;

    const xExtent = [Date.parse(data[0].date), Date.parse(data.at(-1).date)];
    const yExtent = [
        Math.min(...data.map(d => d.price)) * 0.99, // slight bottom padding natively
        Math.max(...data.map(d => d.price)) * 1.01
    ];

    const xScale = d3Scale.scaleLinear()
        .domain(xExtent)
        .range([0, chartWidth]);

    const yScale = d3Scale.scaleLinear()
        .domain(yExtent)
        .range([chartHeight, 0]);

    const xPosition = (point, index) => xExtent[0] === xExtent[1]
        ? index * chartWidth / Math.max(1, data.length - 1)
        : xScale(Date.parse(point.date));
    const lineGenerator = d3Shape.line()
        .x(xPosition)
        .y(d => yScale(d.price))
        .curve(d3Shape.curveMonotoneX);

    const areaGenerator = d3Shape.area()
        .x(xPosition)
        .y0(chartHeight)
        .y1(d => yScale(d.price))
        .curve(d3Shape.curveMonotoneX);


    return (
        // The top bleed overlaps the header; this decorative chart must not intercept menu taps.
        <View pointerEvents="none" style={{ width, height, marginTop: -margin.top }}>
            <Svg width={width} height={height}>
                <Defs>
                    <SvgLinearGradient id="gradientTrend" x1="0%" y1="0%" x2="0%" y2="100%">
                        <Stop offset="0%" stopColor={trendColor} stopOpacity={0.35} />
                        <Stop offset="80%" stopColor={trendColor} stopOpacity={0.05} />
                        <Stop offset="100%" stopColor={trendColor} stopOpacity={0} />
                    </SvgLinearGradient>
                </Defs>
                <Path d={areaGenerator(data)} fill="url(#gradientTrend)" x={margin.left} y={margin.top} />
                <Path d={lineGenerator(data)} fill="none" stroke={trendColor} strokeWidth={3} x={margin.left} y={margin.top} />
            </Svg>
        </View>
    );
}

