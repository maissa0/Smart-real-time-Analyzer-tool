#if UNITY_EDITOR
using System.IO;
using UnityEditor;
using UnityEditor.Build.Reporting;
using UnityEngine;

/// <summary>
/// EDITOR-ONLY — One-click WebGL build for the platform.
///
/// Menu : BMW > Build WebGL (car-twin)
///
/// - Force la liste des scenes sur Assets/Scenes/maissa.unity (la fenetre
///   Build Settings est corrigee au passage).
/// - Construit dans Builds/car-twin-build (Unity nomme les fichiers d'apres
///   ce dossier : car-twin-build.loader.js, .data, .framework.js, .wasm).
/// - Copie automatiquement les fichiers du Build/ vers
///   Frontend_angular/src/assets/car-twin/Build/ (remplace le build deploye).
///
/// Apres ce build : recharger la page Angular avec Ctrl+F5 (cache navigateur).
/// </summary>
public static class BuildWebGL
{
    const string ScenePath = "Assets/Scenes/maissa.unity";
    const string OutputDir = "Builds/car-twin-build";

    [MenuItem("BMW/Build WebGL (car-twin)")]
    public static void Build()
    {
        if (Application.isPlaying)
        {
            EditorUtility.DisplayDialog("Build WebGL",
                "Arretez le mode Play avant de lancer le build.", "OK");
            return;
        }

        // Repare la fenetre Build Settings (liste de scenes vide sinon).
        EditorBuildSettings.scenes = new[] { new EditorBuildSettingsScene(ScenePath, true) };

        BuildPlayerOptions opts = new BuildPlayerOptions
        {
            scenes = new[] { ScenePath },
            locationPathName = OutputDir,
            target = BuildTarget.WebGL,
            options = BuildOptions.None,
        };

        BuildReport report = BuildPipeline.BuildPlayer(opts);
        if (report.summary.result != BuildResult.Succeeded)
        {
            Debug.LogError("[BuildWebGL] Build failed: " + report.summary.result);
            return;
        }

        // Racine du repo = parent du projet Unity (BMW_Digital_Twin/..).
        string projectRoot = Directory.GetParent(Application.dataPath).FullName;
        string src = Path.Combine(projectRoot, OutputDir, "Build");
        string dst = Path.GetFullPath(Path.Combine(
            projectRoot, "..", "Frontend_angular", "src", "assets", "car-twin", "Build"));

        if (!Directory.Exists(src))
        {
            Debug.LogError("[BuildWebGL] Dossier introuvable: " + src);
            return;
        }
        Directory.CreateDirectory(dst);
        int copied = 0;
        foreach (string file in Directory.GetFiles(src))
        {
            File.Copy(file, Path.Combine(dst, Path.GetFileName(file)), true);
            copied++;
        }
        Debug.Log("[BuildWebGL] OK — " + copied + " fichier(s) copie(s) vers " + dst
            + "\nRechargez la page Angular avec Ctrl+F5.");
        EditorUtility.RevealInFinder(Path.Combine(dst, "car-twin-build.wasm"));
    }
}
#endif
