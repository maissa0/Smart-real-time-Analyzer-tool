using UnityEngine;
using UnityEditor;

public class DiagnosticTool : MonoBehaviour
{
    [MenuItem("BMW/Diagnose Transforms")]
    static void Diagnose()
    {
        string[] parts = {
            "paint_doorsfdriver",
            "paint_hood",
            "paint_trunk",
            "g_Tyre_RF001",
            "g_Tyre_RF002",
            "wiperl2",
        };

        foreach (string name in parts)
        {
            GameObject obj = FindObject(name);
            if (obj == null)
            {
                Debug.Log($"❌ NOT FOUND: {name}");
                continue;
            }

            Transform t = obj.transform;
            Debug.Log($"📍 {name}\n" +
                $"   World Pos:   {t.position}\n" +
                $"   World Rot:   {t.eulerAngles}\n" +
                $"   Local Pos:   {t.localPosition}\n" +
                $"   Local Rot:   {t.localEulerAngles}\n" +
                $"   Local Scale: {t.localScale}\n" +
                $"   Parent:      {(t.parent != null ? t.parent.name : "ROOT")}");
        }
    }

    static GameObject FindObject(string name)
    {
        foreach (GameObject obj in
            Resources.FindObjectsOfTypeAll<GameObject>())
        {
            if (obj.name == name && obj.scene.isLoaded)
                return obj;
        }
        return null;
    }
}