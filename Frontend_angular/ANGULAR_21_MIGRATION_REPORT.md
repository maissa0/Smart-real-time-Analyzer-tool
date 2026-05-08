# Angular 21 migration report — `Frontend_angular`

This document summarizes the **post-upgrade alignment** for **`platform`**: moving the workspace to a consistent **Angular 21.2.x** line, the **new `@angular/build` toolchain**, **zoneless** change detection, and corrected TypeScript project layout.

**Scope:** `Frontend_angular/` only (dependencies, CLI config, bootstrap, tsconfig). No feature refactors were required for compile success.

---

## 1. Executive summary

| Area | Before (typical pre-migration state) | After (current) |
|------|--------------------------------------|-----------------|
| **Angular framework** | Mixed **19.x** / **21.x** (`package.json` had `@angular/animations` & CDK on 19, core on 21) | Unified **21.2.6** for framework packages; **CDK 21.2.4** (see §5) |
| **CLI / build** | **`@angular-devkit/build-angular`** (19.x) + partial **`@angular/build`** 21 | **`@angular/cli` 21.2.5** + **`@angular/build` 21.2.5** only |
| **Change detection** | **`provideZoneChangeDetection({ eventCoalescing: true })`** + **Zone.js** in polyfills | **`provideZonelessChangeDetection()`** + **no Zone.js** |
| **Polyfills** | `["zone.js"]` (and zone in Karma) | **`[]`** for application build and for test target |
| **NgRx Signals** | `@ngrx/signals` **19.x** (peer `@angular/core` ^19) | **`^20.0.1`** + **npm `overrides`** for `@angular/core` |
| **tsconfig.app.json** | Only **`src/main.ts`** + **`src/**/*.d.ts`** (incomplete app compilation scope) | **`include`: `src/**/*.ts`** (exclude `*.spec.ts`) |
| **Test tsconfig** | Missing / invalid reference from `angular.json` | **`tsconfig.spec.json`** added |

**Verified:** `npm install`, `ng serve` (development), and `ng build` (production) complete successfully after these changes.

---

## 2. `package.json` — what changed

### 2.1 Angular framework packages (`dependencies`)

All of these are aligned to **the same major/minor family** as Angular 21:

| Package | Version (after) | Notes |
|---------|-----------------|--------|
| `@angular/animations` | `^21.2.6` | Was **19.x**; must match other framework packages |
| `@angular/cdk` | `^21.2.4` | See **§5** — **21.2.6** was not available on npm for CDK at migration time |
| `@angular/common` | `^21.2.6` | |
| `@angular/compiler` | `^21.2.6` | |
| `@angular/core` | `^21.2.6` | |
| `@angular/forms` | `^21.2.6` | |
| `@angular/platform-browser` | `^21.2.6` | |
| `@angular/platform-browser-dynamic` | `^21.2.6` | |
| `@angular/router` | `^21.2.6` | |

### 2.2 Tooling (`devDependencies`)

| Package | Version (after) | Role |
|---------|-----------------|------|
| `@angular/build` | `^21.2.5` | Application build, dev server, Karma builder (see **§3**) |
| `@angular/cli` | `^21.2.5` | Workspace CLI |
| `@angular/compiler-cli` | `^21.2.6` | AOT / `ngc` aligned with compiler **21.2.6** |
| `typescript` | `~5.9.0` | Matches Angular 21’s supported TS range |

**Removed** (no longer listed in `package.json`):

- **`@angular-devkit/build-angular`**, **`@angular-devkit/core`**, **`@angular-devkit/schematics`** — the **application** workflow is handled by **`@angular/build`** under CLI 21.
- **`zone.js`** — not used when running **zoneless** (see **§4**).

**Still present (unchanged intent):**

- **`rxjs` ~7.8.0**, **`tslib`**, **Tailwind / PostCSS**, **`lucide-angular`**, **`autoprefixer`**.

### 2.3 NgRx Signals and `overrides`

| Package | Before | After |
|---------|--------|--------|
| `@ngrx/signals` | **^19.0.0** (peer **@angular/core ^19**) | **^20.0.1** (peer **@angular/core ^20**) |

Because the app runs **Angular 21**, strict peer resolution can still complain. The project uses **`package.json` → `overrides`**:

```json
"overrides": {
  "@ngrx/signals": {
    "@angular/core": "$@angular/core"
  }
}
```

This forces **`@ngrx/signals`** to use the **same `@angular/core` instance** as the application. When NgRx publishes a **21.x**-aligned **`@ngrx/signals`**, you can bump the library and consider **removing `overrides`**.

---

## 3. `angular.json` — builders and polyfills

### 3.1 Build architect

| Setting | Before | After |
|---------|--------|--------|
| **Builder** | `@angular-devkit/build-angular:application` | **`@angular/build:application`** |
| **Polyfills** | `["zone.js"]` | **`[]`** |

The **`application`** builder under **`@angular/build`** is the supported path for **Angular 17+** CLI applications; in **Angular 21** the default stack is **esbuild / Vite-based** tooling owned by **`@angular/build`** (not the legacy webpack-centric **`build-angular`** package).

**Unchanged (still valid):**

- **`browser`: `src/main.ts`**
- **`index`**, **`styles`**, **`assets`**, **`tsConfig`**, **`inlineStyleLanguage`**, production **budgets** / **outputHashing**

### 3.2 Serve architect

| Setting | Before | After |
|---------|--------|--------|
| **Builder** | `@angular-devkit/build-angular:dev-server` | **`@angular/build:dev-server`** |
| **buildTarget** | Same pattern (`project:build:configuration`) | Same pattern |

### 3.3 Test architect

| Setting | Before | After |
|---------|--------|--------|
| **Builder** | `@angular-devkit/build-angular:karma` | **`@angular/build:karma`** |
| **Polyfills** | `["zone.js", "zone.js/testing"]` | **`[]`** |

**Note:** Running **`ng test`** may require adding **Karma / Jasmine / browser launcher** packages to **`devDependencies`** if they are not already pulled in transitively. **`ng serve`** and **`ng build`** do not require them.

---

## 4. Bootstrap — Zone.js vs zoneless (`app.config.ts`)

### Before

```ts
provideZoneChangeDetection({ eventCoalescing: true })
```

Application **polyfills** included **`zone.js`**, so Angular patched async tasks globally to trigger change detection.

### After

```ts
provideZonelessChangeDetection()
```

**Effects:**

- **No Zone.js** in the bundle for change detection (smaller, fewer macro-tasks, clearer stacks).
- Updates rely on **signal updates**, **async Angular APIs**, **`markForCheck` / `ChangeDetectorRef`** where needed, and **OnPush** discipline.

**Why not `provideExperimentalZonelessChangeDetection()`?**  
In current **Angular 21** APIs, **zoneless** is exposed as the **stable** **`provideZonelessChangeDetection()`**. The experimental name is from earlier releases; the migration used the stable provider.

**Fit for this codebase:** Heavy use of **`signal()`**, **`computed()`**, **`effect()`**, and **OnPush** components aligns well with zoneless. If you ever see a view not updating after a non-signal async callback, fix by:

- wiring state through **signals**, or  
- using **`ChangeDetectorRef.markForCheck()`** / **`AsyncPipe`** in the few classic cases.

---

## 5. Version patch mismatches (npm reality)

At migration time:

- **`@angular/core@21.2.6`** existed on npm.
- **`@angular/build@21.2.6`** did **not** exist (**`ETARGET`**); latest was **21.2.5**.
- **`@angular/cdk@21.2.6`** did **not** exist; latest was **21.2.4**.

So the repo intentionally uses:

- **Framework / compiler-cli:** **21.2.6**
- **CLI + build:** **21.2.5**
- **CDK:** **21.2.4**

These combinations are **supported in practice** (peer ranges are flexible across patch lines). When npm publishes **21.2.6** for **CDK** and **`@angular/build`**, you can bump those keys to **21.2.6** for a single patch line.

---

## 6. TypeScript configuration

### 6.1 `tsconfig.app.json`

| Before | After |
|--------|--------|
| `"files": ["src/main.ts"]`, `"include": ["src/**/*.d.ts"]` | `"files": []`, `"include": ["src/**/*.ts"]`, `"exclude": ["src/**/*.spec.ts"]` |

**Why it matters:** The old file only compiled **`main.ts` formally**; the **Angular CLI** still built the app via its own graph, but **IDE / tsc --project** behavior was misleading. The new layout matches how an application **source tree** is normally included.

### 6.2 `tsconfig.spec.json` (new)

- **`include`:** `src/**/*.spec.ts`
- **`types`:** `jasmine`
- **`extends`:** root `tsconfig.json`

This satisfies **`angular.json` → `architect.test.options.tsConfig`**.

---

## 7. Third-party: `lucide-angular`

- **`lucide-angular@^1.0.0`** declares peer **`@angular/core` / `@angular/common`** in range **`13.x–21.x`**, so it is **compatible with Angular 21** without a major bump.
- No template or import changes were required for the migration build.

---

## 8. What was *not* changed

- **`src/main.ts`** — still **`bootstrapApplication(AppComponent, appConfig)`**.
- **Routing, features, stores, interceptors** — no API migrations were required for **21.2** in this tree.
- **No new npm packages** were added beyond resolving the dependency tree after edits (Karma stack optional for tests).

---

## 9. How to verify locally

```bash
cd Frontend_angular
npm install
npm run start
# or
npx ng serve --configuration development
```

```bash
npx ng build
```

Optional (may need extra devDependencies):

```bash
npx ng test
```

---

## 10. Follow-up recommendations

1. **Remove `overrides`** when **`@ngrx/signals`** officially supports **Angular 21** peers.  
2. **Bump CDK and `@angular/build`** to **21.2.6** when npm has those versions.  
3. If **`ng test`** fails, add **`karma`**, **`jasmine-core`**, **`karma-jasmine`**, **`karma-chrome-launcher`**, and decide whether tests should stay **zoneless** or reintroduce **Zone.js only for Karma**.  
4. Run **`ng update @angular/core @angular/cli`** on future minors to stay within **21.2.x** with official migrations.

---

*Report generated from the migration state of `Frontend_angular` (Angular **21.2.x**, TypeScript **5.9**, zoneless bootstrap, `@angular/build` toolchain).*
