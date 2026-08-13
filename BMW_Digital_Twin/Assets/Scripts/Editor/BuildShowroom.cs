#if UNITY_EDITOR
using System.Collections.Generic;
using UnityEngine;
using UnityEditor;
using UnityEngine.Rendering;
using UnityEditor.SceneManagement;
using UnityEngine.SceneManagement;

/// <summary>
/// EDITOR-ONLY — Construit un décor "showroom" avec estrade autour de la voiture.
///
/// Menu : BMW > Build Showroom (Estrade)
///
/// v2 : calcul robuste de la position/du sol de la voiture (ignore les pièces
///      parasites du GLB qui faussaient l'emprise) + refuse de tourner en mode Play.
///
/// Garanties :
///  - Ne modifie AUCUN objet existant (CarRoot, newCarBetter, caméras, lumière...).
///  - Ne renomme rien. Tous les objets créés sont préfixés "Showroom_" et
///    regroupés sous un parent unique "Showroom_Environment".
///  - Fichier 100% éditeur : jamais inclus dans le build WebGL.
/// </summary>
public static class BuildShowroom
{
    const string RootName = "Showroom_Environment";
    const int WallCount = 12;
    const float WallRadius = 14f;
    const float WallHeight = 6f;

    [MenuItem("BMW/Build Showroom (Estrade)")]
    static void Build()
    {
        // Construire en mode Play = perdu à l'arrêt. On refuse proprement.
        if (Application.isPlaying)
        {
            EditorUtility.DisplayDialog("Showroom",
                "Vous etes en mode Play : tout objet cree serait perdu a l'arret.\n\n" +
                "Arretez le mode Play (bouton en haut), puis relancez BMW > Build Showroom (Estrade).",
                "OK");
            return;
        }

        GameObject old = GameObject.Find(RootName);
        if (old != null)
        {
            if (!EditorUtility.DisplayDialog("Showroom",
                "Un decor '" + RootName + "' existe deja. Le remplacer ?",
                "Remplacer", "Annuler"))
                return;
            Undo.DestroyObjectImmediate(old);
        }

        // ── Référence robuste : où est la voiture, où est le sol ─────────
        Vector3 center = Vector3.zero;
        float groundY = 0f;

        GameObject car = GameObject.Find("newCarBetter");
        if (car == null) car = GameObject.Find("CarRoot");
        if (car != null && !ComputeRobustFootprint(car, out center, out groundY))
        {
            // Repli : l'origine du modèle (le GLB pose sa racine au sol).
            center = new Vector3(car.transform.position.x, 0f, car.transform.position.z);
            groundY = car.transform.position.y;
        }

        float floorY = groundY - 0.3f;

        GameObject root = new GameObject(RootName);
        Undo.RegisterCreatedObjectUndo(root, "Build Showroom");

        Transform rootT = root.transform;

        // ── Matériaux ────────────────────────────────────────────────────
        Material matFloor    = MakeMat("Showroom_Floor_Mat",   new Color(0.10f, 0.10f, 0.11f), 0.05f, 0.85f);
        Material matPodium   = MakeMat("Showroom_Podium_Mat",  new Color(0.75f, 0.77f, 0.78f), 0.30f, 0.60f);
        Material matWall     = MakeMat("Showroom_Wall_Mat",    new Color(0.23f, 0.24f, 0.26f), 0.00f, 0.20f);
        Material matCeiling  = MakeMat("Showroom_Ceiling_Mat", new Color(0.12f, 0.12f, 0.13f), 0.00f, 0.10f);
        Material matLedBlue  = MakeEmissive("Showroom_LedBlue_Mat",  new Color(0.20f, 0.60f, 1.00f), 2.0f);
        Material matLedWhite = MakeEmissive("Showroom_LedWhite_Mat", Color.white, 1.6f);

        // ── 1. Sol ───────────────────────────────────────────────────────
        Primitive(PrimitiveType.Plane, "Showroom_Floor", rootT,
            new Vector3(center.x, floorY, center.z), new Vector3(10f, 1f, 10f), matFloor);

        // ── 2. Estrade — le dessus arrive exactement sous les roues ──────
        Primitive(PrimitiveType.Cylinder, "Showroom_Podium", rootT,
            new Vector3(center.x, groundY - 0.15f, center.z), new Vector3(7f, 0.15f, 7f), matPodium);

        Primitive(PrimitiveType.Cylinder, "Showroom_PodiumRing", rootT,
            new Vector3(center.x, floorY + 0.02f, center.z), new Vector3(7.4f, 0.02f, 7.4f), matLedBlue);

        // ── 3. Murs en cercle + bandeaux LED ─────────────────────────────
        float wallLen = 2f * Mathf.PI * WallRadius / WallCount + 0.4f;
        for (int k = 0; k < WallCount; k++)
        {
            float ang = k * (360f / WallCount);
            float rad = ang * Mathf.Deg2Rad;
            Vector3 dir = new Vector3(Mathf.Sin(rad), 0f, Mathf.Cos(rad));

            GameObject wall = Primitive(PrimitiveType.Cube, "Showroom_Wall_" + k, rootT,
                new Vector3(center.x, floorY + WallHeight * 0.5f, center.z) + dir * WallRadius,
                new Vector3(wallLen, WallHeight, 0.3f), matWall);
            wall.transform.rotation = Quaternion.Euler(0f, ang, 0f);

            GameObject strip = Primitive(PrimitiveType.Cube, "Showroom_LedStrip_" + k, rootT,
                new Vector3(center.x, floorY + 4.5f, center.z) + dir * (WallRadius - 0.20f),
                new Vector3(wallLen - 0.6f, 0.08f, 0.05f), matLedWhite);
            strip.transform.rotation = Quaternion.Euler(0f, ang, 0f);
        }

        // ── 4. Plafond + panneaux lumineux ───────────────────────────────
        Primitive(PrimitiveType.Cylinder, "Showroom_Ceiling", rootT,
            new Vector3(center.x, floorY + WallHeight, center.z), new Vector3(15f, 0.05f, 15f), matCeiling);

        for (int k = 0; k < 3; k++)
        {
            float off = (k - 1) * 2.6f;
            Primitive(PrimitiveType.Cube, "Showroom_LightPanel_" + k, rootT,
                new Vector3(center.x + off, floorY + WallHeight - 0.15f, center.z),
                new Vector3(2.2f, 0.06f, 1.0f), matLedWhite);
        }

        // ── 5. Lumières ──────────────────────────────────────────────────
        // Le plafond bloque l'ombre de la Directional Light : on éclaire
        // l'intérieur avec 3 spots + 1 point light douce au-dessus de la voiture.
        for (int k = 0; k < 3; k++)
        {
            float ang = k * 120f * Mathf.Deg2Rad;
            Vector3 pos = new Vector3(center.x + Mathf.Sin(ang) * 5f,
                                      groundY + 4.6f,
                                      center.z + Mathf.Cos(ang) * 5f);

            GameObject go = new GameObject("Showroom_Spot_" + k);
            go.transform.SetParent(rootT, true);
            go.transform.position = pos;
            go.transform.LookAt(new Vector3(center.x, groundY + 0.8f, center.z));

            Light spot = go.AddComponent<Light>();
            spot.type = LightType.Spot;
            spot.range = 16f;
            spot.spotAngle = 70f;
            spot.intensity = 3.0f;
            spot.color = new Color(1f, 0.97f, 0.92f);
            spot.shadows = (k == 0) ? LightShadows.Soft : LightShadows.None;
        }

        GameObject fillGo = new GameObject("Showroom_FillLight");
        fillGo.transform.SetParent(rootT, true);
        fillGo.transform.position = new Vector3(center.x, groundY + 3.5f, center.z);
        Light fill = fillGo.AddComponent<Light>();
        fill.type = LightType.Point;
        fill.range = 14f;
        fill.intensity = 1.1f;
        fill.color = Color.white;
        fill.shadows = LightShadows.None;

        // ── 6. Reflection probe ──────────────────────────────────────────
        GameObject probeGo = new GameObject("Showroom_ReflectionProbe");
        probeGo.transform.SetParent(rootT, true);
        probeGo.transform.position = new Vector3(center.x, groundY + 1.2f, center.z);

        ReflectionProbe probe = probeGo.AddComponent<ReflectionProbe>();
        probe.mode = ReflectionProbeMode.Realtime;
        probe.refreshMode = ReflectionProbeRefreshMode.OnAwake;
        probe.size = new Vector3(30f, 12f, 30f);
        probe.intensity = 1f;

        EditorSceneManager.MarkSceneDirty(SceneManager.GetActiveScene());
        Selection.activeGameObject = root;

        Debug.Log("[BuildShowroom] OK — centre voiture: " + center.ToString("F2") +
                  " | sol des roues y=" + groundY.ToString("F3") +
                  " | voiture detectee: " + (car != null ? car.name : "aucune") +
                  ". Pensez a sauvegarder la scene (Ctrl+S).");
    }

    /// <summary>
    /// Emprise robuste de la voiture : médiane des centres des renderers,
    /// puis on ne garde que les pièces proches de cette médiane — les
    /// pièces parasites du GLB (loin ou démesurées) sont ignorées.
    /// </summary>
    static bool ComputeRobustFootprint(GameObject carGo, out Vector3 center, out float groundY)
    {
        center = Vector3.zero;
        groundY = 0f;

        Renderer[] all = carGo.GetComponentsInChildren<Renderer>();
        if (all.Length == 0) return false;

        var xs = new List<float>();
        var ys = new List<float>();
        var zs = new List<float>();
        foreach (Renderer r in all)
        {
            Vector3 c = r.bounds.center;
            xs.Add(c.x); ys.Add(c.y); zs.Add(c.z);
        }
        xs.Sort(); ys.Sort(); zs.Sort();
        Vector3 median = new Vector3(xs[xs.Count / 2], ys[ys.Count / 2], zs[zs.Count / 2]);

        bool hasBounds = false;
        Bounds acc = new Bounds();
        foreach (Renderer r in all)
        {
            Bounds b = r.bounds;
            // On ignore les pièces aberrantes : trop loin du corps de la
            // voiture ou avec une emprise démesurée (> 8 m).
            if (Vector3.Distance(b.center, median) > 6f) continue;
            if (b.size.magnitude > 8f) continue;

            if (!hasBounds) { acc = b; hasBounds = true; }
            else acc.Encapsulate(b);
        }
        if (!hasBounds) return false;

        center = new Vector3(acc.center.x, 0f, acc.center.z);
        groundY = acc.min.y;

        // Garde-fou : le sol ne peut pas être à plus de 2 m sous le centre.
        if (median.y - groundY > 2.5f) groundY = median.y - 0.8f;

        return true;
    }

    // ── Helpers ──────────────────────────────────────────────────────────
    static GameObject Primitive(PrimitiveType type, string name, Transform parent,
                                Vector3 pos, Vector3 scale, Material mat)
    {
        GameObject go = GameObject.CreatePrimitive(type);
        go.name = name;
        go.transform.SetParent(parent, true);
        go.transform.position = pos;
        go.transform.localScale = scale;

        Renderer r = go.GetComponent<Renderer>();
        if (r != null) r.sharedMaterial = mat;

        Collider c = go.GetComponent<Collider>();
        if (c != null) Object.DestroyImmediate(c);

        return go;
    }

    static Material MakeMat(string name, Color albedo, float metallic, float smoothness)
    {
        Material m = new Material(Shader.Find("Standard"));
        m.name = name;
        m.color = albedo;
        m.SetFloat("_Metallic", metallic);
        m.SetFloat("_Glossiness", smoothness);
        return m;
    }

    static Material MakeEmissive(string name, Color color, float intensity)
    {
        Material m = MakeMat(name, Color.black, 0f, 0.5f);
        m.EnableKeyword("_EMISSION");
        m.globalIlluminationFlags = MaterialGlobalIlluminationFlags.RealtimeEmissive;
        m.SetColor("_EmissionColor", color * intensity);
        return m;
    }
}
#endif
