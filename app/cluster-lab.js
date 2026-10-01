import React from 'react';
import { Redirect, useLocalSearchParams } from 'expo-router';

// Existing bookmarks and native probe links now open the single Home tab.
export default function FormerGlassLabRoute() {
    const params = useLocalSearchParams();
    return <Redirect href={{ pathname: '/', params }} />;
}
