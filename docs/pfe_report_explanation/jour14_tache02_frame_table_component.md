# FrameTableComponent — extraction du rendu de la table de trames

## Ce qui a été fait

- Nouveau dossier **`Frontend_angular/src/app/features/sniffer/frame-table/`** et composant **`FrameTableComponent`** (**`app-frame-table`**, **standalone**, **`OnPush`**).
- **`input()`** Angular : **`frames`**, **`sessionStartTs`**, **`visibleSignalNames`** (**`Set<string>`**) ; **`output()`** **`frameClicked`** (pour extension future lors du clic ligne).
- Table HTML maison (**`ft-*`**) : entête sticky, lignes CAN + sous-lignes signaux après **`parseSignals`** (JSON depuis **`CanFrame.signals`**), badge ID vert KPIT, direction **Tx** surlignée, état vide **« No frames to display »**.
- **`SnifferComponent`** : import + **`imports: [ … FrameTableComponent ]`** ; onglet **TABLE** remplacé par **`<app-frame-table [frames]="filteredVisibleFrames()" [sessionStartTs]="…" [visibleSignalNames]="visibleSignalNames()">`** enveloppé du **`div.kpit-table-wrap`** inchangé.
- Correction minimale pour parité avec **`isSignalNameVisible`** du Sniffer : **`visibleSignalNames().size === 0 || visibleSignalNames().has(…)`** (le gabarit fourni utilisait **`has` seule**, ce qui masquait toutes les sous-lignes quand le set est vide après sélection de session).

## Ce que ça fait pour le projet

- **Découplage visuel / logique** : télémetrie, playback, filtres **`filteredVisibleFrames`** et checklist signaux restent dans le **`SnifferComponent`** ; la table devient réutilisable (aperçus, modales).
- Réduit les centaines de lignes de markup dans **`sniffer.component.html`** tout en gardant une feuille de style KPIT cohérente.

## Comment — explication technique

- **`input<CanFrame[]>([])`** reçoit la liste déjà filtrée côté parent — pas de **`TelemetryService`** ni **`HttpClient`** dans l’enfant.
- Relatif **`+Xs`** : **`frame.timestamp - sessionStartTs()`** comme avant (valeur défaut **`0`** si pas de session).
- Méthode **`parseSignals`** locale typée **`ParsedSignal[]`** — équivalent fonctionnel au **`parseSignals` / `getSignals`** côté parent pour l’affichage.

## Pourquoi — justification

- **Pure presentational component** : même philosophie que la doc interne (**design decision** dans le fichier) — éviter d’injecter **`TelemetryService`** et la complexité playback dans un enfant encore instable du refactor God Component.

## Explication sans background informatique

Le Sniffer prépare encore la **liste des messages du bus** (filtrage, lecture…) ; une **nouvelle fenêtre tableau** peint simplement ces lignes et les lignes détaillées des **signaux** cochées, comme un **formulaire prérempli** que l’affiche sans refaire les calculs.

## Comment tester manuellement

```powershell
cd C:/tools/Kpit_c/Frontend_angular
npx ng build --configuration development 2>&1 | Select-Object -Last 8
```

- Sniffer : onglet **TABLE** — colonnes, offsets temps, lignes signals selon filtres (**Address / Bus / Signals**).
- Sélectionnez/décochez des signaux dans la checklist : sous-lignes affichées / masquées comme avant la extraction.

## Problèmes rencontrés et corrections appliquées

- **Sémantique `visibleSignalNames`** : le template initial (`has` uniquement) ne reproduisait pas **`return set.size === 0 || set.has(name)`** — corrigé pour ne pas perdre les sous-lignes par défaut.
- **`ng build`** : succès ; derniers diagnostics existants sur **`SessionListComponent`** (NG8102) sans lien avec **`FrameTableComponent`**.

## Mots clés pour la soutenance

**Refactoring UI**, **`FrameTableComponent`**, **`input()` / `output()`**, **`ChangeDetectionStrategy.OnPush`**, **table présentation**, **`filteredVisibleFrames`**, **`Set` filtre signaux**, **parse JSON signaux**, **God component**, **Sniffer**.
