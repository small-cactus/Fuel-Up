# Gas preferences and shorter onboarding

Onboarding now has four native sliding pages: welcome, location, fuel, and Gas preferences. Granting location advances to fuel once a usable fix arrives. The onboarding draft and its initial nearby lookup use six miles; the Settings radius slider remains available.

Gas preferences uses the requested subtitle. Each section owns a separate native search above its container, shown only above ten options. Searches scroll with their sections. Native iOS 26 safe-area bars and soft scroll edges let rows blur beneath the fixed heading and bottom controls.

## Validation

- 28 focused tests passed across native onboarding, assets, state continuity, and preferences persistence.
- Debug simulator and signed Release iPhone builds succeeded.
- iPhone 13 mini simulator, iOS 26.5: granting permission advanced from page 2 directly to fuel, page 3, without another tap. Continuing reached Gas preferences, page 4. No radius page remains in the pager.
- Live inventory had 16 station brands and four memberships: inline station search appeared; membership search did not.
- Temporary native-view fixtures verified that station search stays hidden at nine and ten options and appears at eleven. Eleven synthetic memberships showed their own search. Searching memberships for `10` and stations for `Wawa` produced independent results. The keyboard hid the footer; Done restored it.
- Light and dark scrolling were visually inspected on the compact simulator. Rows blurred beneath both heading and footer, and the search moved with the list. Dark mode was applied through a temporary view-prop override. Fixtures were restored and the simulator app restarted after QA.
- Signed Release build installed successfully on Anthony's iPhone, bundle `com.anthonyh.fuelup`. Installation was verified from devicectl's successful result. Physical-phone interaction was not tested.
- Cluster rendering was not modified; the cluster integration probe was not run.

## Screenshots

- [Light scroll edges](evidence/2026-10-02-gas-preferences/scroll-light.png)
- [Dark scroll edges](evidence/2026-10-02-gas-preferences/scroll-dark.png)
- [Independent searches with synthetic memberships](evidence/2026-10-02-gas-preferences/independent-search-fixture.png)
