# Core Mission

The primary objectives of this app are fiercely prioritized as follows:
1. **Priority #1: Native, Beautiful, and Simple Design** - The user experience must be as simple, beautiful, and least confusing as humanly possible, favoring native iOS UI and interactions above all else.
2. **Priority #2: Fastest, Cheapest Gas** - The app must aggressively find and present the closest, cheapest gas price to the user's current location as fast as possible.

---

# Design Guidelines

1. **Native iOS First**: Always prioritize implementing the most native closest UI and actions. Before building anything custom, you MUST exhaustively search for a native approach or an Apple native iOS ported version (e.g., Apple Maps over third-party maps). Never use a third-party version if an Apple native public version exists.

2. **Liquid Glass Effect**: All UI components must use the liquid glass effect where applicable. Documentation is available at `LiquidGlassDocs.md` and `LiquidGlassTabsDocs.md`. NEVER reinvent the glass effect yourself; use the library and docs to implement it.

3. **Fallback to Simple Modernity**: If a native approach or Liquid Glass Effect is strictly impossible to implement, do NOT attempt to mimic it. Instead, build a simple, clean, and modern version of the component. 

4. **Universal Responsiveness**: Everything must be specifically responsive and adapt flawlessly on every single iPhone model by default.

5. **Theme Support**: All implementations must support our dark and light themes by default out of the box.

6. **Code Quality and Maintainability**: 
   - Support a forward-thinking code style that allows for integrations easily.
   - Code should be written to be easy to maintain and edit, even if it results in longer or more verbose code.
   - *Exception*: If the code length would become huge or unmanageable, then optimize for whatever approach is the most efficient at the time.

7. **No Monofiles**: Never use monofiles. All components should be ported from separate files and linked in screens.
   - *Exceptions*: You may include a component in the current file ONLY if it is NEVER to be repeated elsewhere, or if it is so simple that creating a separate file would be more time-consuming than implementing it inline.