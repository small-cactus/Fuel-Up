const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { supported, resolveLanguage, translate } = require('../src/localization/core.cjs');
const catalog = require('../src/localization/translations.json');
const { build } = require('../scripts/localization/buildResources.cjs');

test('language resolution handles regional variants and falls back safely', () => {
  for (const [input, expected] of [['es-US','es'], ['zh-TW','zh-Hant'], ['zh_HK','zh-Hant'], ['zh-CN','zh-Hans'], ['zh-Hans-US','zh-Hans'], ['tl-PH','fil'], ['fr-CA','fr'], ['vi-VN','vi'], ['ar','en'], [null,'en']]) {
    assert.equal(resolveLanguage(input), expected);
  }
  assert.equal(translate(catalog, 'en', 'Language'), 'Language');
  assert.equal(translate(catalog, 'es', 'Language'), 'Idioma');
  assert.equal(translate(catalog, 'es', 'Unknown future key'), 'Unknown future key');
});

test('every shipped translation is nonempty and preserves interpolation tokens', () => {
  const keys = Object.keys(catalog.es).sort();
  const tokens = value => (value.match(/\{\w+\}/g) || []).sort();
  for (const language of supported.filter(l => l !== 'en')) {
    assert.deepEqual(Object.keys(catalog[language]).sort(), keys);
    for (const key of keys) {
      assert.ok(catalog[language][key].trim(), `${language}: ${key}`);
      assert.deepEqual(tokens(catalog[language][key]), tokens(key), `${language}: ${key}`);
    }
    assert.ok(translate(catalog, language, 'got something at {station}? 👀', {station: 'Mobil'}).includes('Mobil'));
  }
});

test('native build resources include translated system permission purpose strings', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fuel-localization-'));
  try {
    assert.deepEqual(build(dir), supported);
    for (const language of supported) {
      const folder = path.join(dir, `${language}.lproj`);
      const ui = fs.readFileSync(path.join(folder,'Localizable.strings'),'utf8');
      const info = fs.readFileSync(path.join(folder,'InfoPlist.strings'),'utf8');
      assert.ok(ui.includes(JSON.stringify(translate(catalog, language, 'Help Fuel Up'))));
      for (const key of ['NSMotionUsageDescription','NSLocationWhenInUseUsageDescription','NSLocationAlwaysAndWhenInUseUsageDescription']) assert.ok(info.includes(key));
      if (language !== 'en') assert.ok(!info.includes('Fuel Up uses your precise location'));
    }
  } finally { fs.rmSync(dir, {recursive:true,force:true}); }
});

test('Xcode language resource registration is repeatable without duplicates', () => {
  // A minimal project keeps this check independent of ignored prebuild output.
  const project = require('xcode').project('localization-test.pbxproj');
  project.hash = {project: {rootObject: 'P', objects: {
    PBXProject: {P: {isa: 'PBXProject', mainGroup: 'G', targets: [{value:'T'}], knownRegions:['en']}},
    PBXNativeTarget: {T: {isa:'PBXNativeTarget', name:'FuelUp', buildPhases:[{value:'R',comment:'Resources'}]}},
    PBXGroup: {G: {isa:'PBXGroup', children:[]}},
    PBXFileReference: {}, PBXBuildFile: {},
    PBXResourcesBuildPhase: {R: {isa:'PBXResourcesBuildPhase', files:[]}, R_comment:'Resources'},
  }}};
  const configure = require('../plugins/withFuelUpLocalization').configure;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fuel-xcode-localization-'));
  try {
    configure(project, dir);
    const once = project.writeSync();
    configure(project, dir);
    assert.equal(project.writeSync(), once);
    for (const language of supported) assert.ok(project.hasFile(`FuelUp/Localization/${language}.lproj`));
    for (const ref of Object.values(project.pbxFileReferenceSection())) {
      if (typeof ref === 'object' && String(ref.path).includes('FuelUp/Localization/')) {
        assert.equal(ref.sourceTree, 'SOURCE_ROOT');
        assert.equal(ref.lastKnownFileType, 'folder');
      }
    }
    assert.notEqual(project.pbxGroupByName('Resources').path, 'undefined');
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});

test('relative report ages use the selected language and keep missing dates unavailable', () => {
  const { formatRelativeTime } = require('../src/localization/core.cjs');
  const now = Date.parse('2026-10-07T01:00:00Z');
  assert.equal(formatRelativeTime(catalog, 'es', null, now), '—');
  assert.equal(formatRelativeTime(catalog, 'es', 'not a date', now), '—');
  assert.equal(formatRelativeTime(catalog, 'es', new Date(now).toISOString(), now), 'Ahora mismo');
  assert.equal(formatRelativeTime(catalog, 'fr', '2026-10-07T00:00:00Z', now), 'il y a 1 h');
});

test('Settings shows the chosen language and opens native app settings', async () => {
  const React = require('react');
  const { act, create } = require('react-test-renderer');
  const load = require('./helpers/loadComponent.cjs');
  global.IS_REACT_ACT_ENVIRONMENT = true;
  let opened = 0;
  const names = ['Button','Host','HStack','Image','Label','LabeledContent','Picker','Slider','Text'];
  const form = load('src/components/settings/NativeSettingsForm.js', {
    '../../localization': {t: (key, values) => translate(catalog,'es',key,values),languageName:'Español'},
    '../../../modules/fuel-up-glass': {GlassForm:'Form',GlassSection:'Section'},
    'react-native': {Linking:{openSettings:async()=>{opened++;}}},
    '@expo/ui/swift-ui':Object.fromEntries(names.map(n=>[n,n])),
    '@expo/ui/swift-ui/modifiers':{font:()=>({}),foregroundStyle:()=>({}),tag:v=>v},
    '../../lib/drivingResearchPolicy':{nativeResearchOwnsTracking:()=>true},
    '../../lib/fuelGrade':{getFuelGradeMeta:()=>({label:'Premium'})},
    '../../lib/fuelSearchState':{MIN_SEARCH_RADIUS_MILES:1,MAX_SEARCH_RADIUS_MILES:25},
  }).default;
  let view;
  await act(async()=>{view=create(React.createElement(form,{preferredOctane:'premium',searchRadiusMiles:10}));});
  const button=view.root.findAllByType('Button').find(n=>n.props.testID==='settings-language');
  assert.ok(button);
  assert.equal(button.findByType('LabeledContent').props.label.props.title,'Idioma');
  assert.equal(button.findByType('Text').props.children,'Español');
  await act(async()=>{await button.props.onPress();});
  assert.equal(opened,1);
  assert.ok(view.root.findAllByType('Text').some(n=>String(n.props.children).includes(catalog.es.Premium)));
  await act(async()=>view.unmount());
});
