import React, { memo } from 'react';
import GlassActionButton from './native/GlassActionButton';

function ResetToCheapestButton({ label = 'Reset to Cheapest', ...props }) {
    return <GlassActionButton {...props} title={label} icon="arrow.uturn.backward" />;
}
export default memo(ResetToCheapestButton);
