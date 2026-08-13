using UnityEngine;
using UnityEditor;

public class SetupHierarchy : MonoBehaviour
{
    [MenuItem("BMW/Setup Hierarchy")]
    static void Setup()
    {
        // ── DOOR FL ──────────────────────────────────────────
        SetParent("paint_doorsfdriver", new string[]
        {
            "ChromeDriverDoor",
            "ChromeDoorLatchesDriver",
            "ChromeDoorsLatches",
            "ChromeDoorSillsPivots",
            "ChromeHarmanKardonLogoDriverDoor",
            "ChromeMKickPlatesDoorSills",
            "DoorSillSecondaryDriver",
            "EmissiveDriverDoor",
            "HarmanKardonDriverDoor",
            "HarmanKardonLogoDriverDoor",
            "LeatherThirdDriverDoor",
            "LogoMKickPlatesDoorSills",
            "MetalDetailDoorSillDriver",
            "MetalDetail_DoorsillsBig",
            "PianoBlackDriverDoor",
            "PlasticDoorSillDriverDoor",
            "PlasticDoorSillDriverDoor001",
            "PlasticDoorSills2",
            "blackplastic_doorsf2Driver",
            "doorhandlelf_a",
        });

        // ── DOOR FR ──────────────────────────────────────────
        SetParent("paint_doorsfpass", new string[]
        {
            "ChromeDoorLatchesPass",
            "ChromeHarmanKardonLogoPassDoor",
            "ChromePassDoorLatchforgot",
            "EmissivePassDoor",
            "HarmanKardonPassDoor",
            "MetalDetailDoorSillPass",
            "PianoBlackPassDoor",
            "PlasticPassDoor",
            "blackplastic_doorsf2Pass",
        });

        // ── DOOR RL ──────────────────────────────────────────
        SetParent("paint_doorsrdriverrear", new string[]
        {
            "ChromeDoorDriverRearLatchNew",
            "ChromeDoorLatchDriverRear",
            "ChromeHarmanKardonLogoDriverDoorRear",
            "DoorSillSecondaryDriverRear",
            "EmissiveBoltsDoorSills",
            "EmissiveDoorSIlls",
            "HarmanKardonDriverDoorRear",
            "HarmanKardonLogoDriverDoorRear",
            "MetalDetailDoorSillDriverRear",
            "PianoBlackDriverRearDoor",
            "blackplastic_doorsr2driverrear",
        });

        // ── DOOR RR ──────────────────────────────────────────
        SetParent("paint_doorsr", new string[]
        {
            "ChromeDoorLattchPassRear",
            "ChromeDoorPassRearLatchNew",
            "ChromeHarmanKardonLogoPassDoorRear",
            "DoorSillSecondaryPassRear",
            "HarmanKardonPassDoorRear",
            "MetalDetailDoorSillPassRear",
            "PianoBlackPassRearDoor",
            "PlasticDoorSillPassDoorRear",
            "blackplastic_doorsr",
            "blackplastic_doorsr2",
        });

        // ── HOOD ─────────────────────────────────────────────
        SetParent("paint_hood", new string[]
        {
            "BlueWashCapEngine",
            "ChromeHangersHood",
            "MetalBodyEngineBayHood",
            "PianoBlackHoodEngineBay",
            "paint_hood.001",
        });

        // ── TRUNK ────────────────────────────────────────────
        SetParent("paint_trunk", new string[]
        {
            "AlcantaraMainRearTrunk",
            "ChromeHangersRear",
            "ChromeTrunkOpen",
            "EmissiveTrunkOpen",
            "EmissiveTrunkSecondary",
            "GrillsNetsTrunk",
            "LeatherThirdTrunk",
            "MetalBodyRearTrunk",
            "MetalBodyTrunkOpenRear",
            "PlasticRearTrunkInt",
            "PlasticTrunkOpen",
            "blackplastic_badgetrunk",
            "blackplastic_badgetrunk001",
            "compot_boot",
            "compot_boot_text",
        });

        // ── STEERING WHEEL ───────────────────────────────────
        SetParent("bmw_logo_p047", new string[]
        {
            "BatVolanStanga",
            "ChromeButonVolInterior",
            "EmissiveBatVolanStanga",
            "EmissiveBeteVolan",
            "GlavizantButonInterior",
            "PianoBlackVolInterior",
            "Plastic_BeteVolan2023",
            "m1m2_badges001_002",
            "m_badge_steer001_002",
            "steer001_001_001_002",
            "steer001_001_001_002.001",
            "steer001_003",
            "steer_airbag_badges001_002",
            "steer_airbag_stich001_002",
            "steer_airbag_stich002_002",
            "steer_decor001_002",
            "steer_gloss_krutilki001_002",
            "steer_knopkiiii001_001_001_002",
            "steer_knopkiiii001_003",
            "steer_monik_002",
            "steer_monik_glass_002",
            "steer_red_buttons001_002",
            "steer_screws_002",
            "steer_sensor_base_002",
            "steer_stich002_002",
            "steeringwheel",
            "steeringwheel02.002",
            "steeringwheel05.001",
            "steeringwheel13_002",
            "steeringwheel15_002",
        });

        // ── WHEELS — use local space ──────────────────────────
        SetParentLocal("g_Tyre_RF002", new string[]
        {
            "EXT_RIM_BRAKE_RF002",
            "EXT_RIM_BRAKEDISC_RF002",
            "nipel002", "nipel_chrome_lf",
            "rim004", "rim005",
            "rim_m_badge002", "rim_metal002",
            "rim_ring002", "screws002", "rim_badge_lf",
        });

        SetParentLocal("g_Tyre_RF003", new string[]
        {
            "EXT_RIM_BRAKE_RF003",
            "EXT_RIM_BRAKEDISC_RF003",
            "nipel001", "nipel_chrome_rf",
            "rim002", "rim003",
            "rim_m_badge001", "rim_metal001",
            "rim_ring001", "screws001", "rim_badge_rf",
        });

        SetParentLocal("g_Tyre_RF001", new string[]
        {
            "EXT_RIM_BRAKE_RF",
            "EXT_RIM_BRAKEDISC_RF",
            "nipel", "nipel_chrome_rr",
            "rim", "rim1",
            "rim_m_badge", "rim_metal",
            "rim_ring", "screws", "rim_badge_lr",
        });

        SetParentLocal("g_Tyre_RF004", new string[]
        {
            "EXT_RIM_BRAKE_RF001",
            "EXT_RIM_BRAKEDISC_RF001",
            "nipel003", "nipel_chrome_lr",
            "rim006", "rim007",
            "rim_m_badge003", "rim_metal003",
            "rim_ring003", "screws003", "rim_badge_rr",
        });

        // ── WIPERS ───────────────────────────────────────────
        SetParent("wiperl2", new string[] { "wiperl" });
        SetParent("wiperr2", new string[] { "wiperr" });

        Debug.Log("✅ BMW Hierarchy setup complete!");
    }

    // Keeps world position — for doors, hood, trunk, steering
    static void SetParent(string parentName, string[] childNames)
    {
        GameObject parent = FindInScene(parentName);
        if (parent == null)
        {
            Debug.LogWarning($"⚠️ Parent not found: {parentName}");
            return;
        }
        foreach (string childName in childNames)
        {
            GameObject child = FindInScene(childName);
            if (child == null)
            {
                Debug.LogWarning($"⚠️ Child not found: {childName}");
                continue;
            }
            child.transform.SetParent(parent.transform, true);
            Debug.Log($"  ✅ {childName} → {parentName}");
        }
    }

    // Uses local space — for wheels so rim sits exactly on tyre
    static void SetParentLocal(string parentName, string[] childNames)
    {
        GameObject parent = FindInScene(parentName);
        if (parent == null)
        {
            Debug.LogWarning($"⚠️ Parent not found: {parentName}");
            return;
        }
        foreach (string childName in childNames)
        {
            GameObject child = FindInScene(childName);
            if (child == null)
            {
                Debug.LogWarning($"⚠️ Child not found: {childName}");
                continue;
            }
            // false = do NOT keep world position
            // child snaps to parent local space
            child.transform.SetParent(parent.transform, false);
            Debug.Log($"  ✅ {childName} → {parentName} (local)");
        }
    }

    static GameObject FindInScene(string name)
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