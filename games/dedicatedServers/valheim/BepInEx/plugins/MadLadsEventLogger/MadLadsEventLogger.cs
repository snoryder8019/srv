using System;
using System.IO;
using System.Collections.Generic;
using System.Reflection;
using BepInEx;
using HarmonyLib;
using UnityEngine;

namespace MadLadsEventLogger
{
    [BepInPlugin("com.madladslab.eventlogger", "MadLads Event Logger", "1.0.0")]
    public class EventLoggerPlugin : BaseUnityPlugin
    {
        public static string logPath;
        static readonly object logLock = new object();

        // Track last hit source per character instance ID for kill attribution
        public static Dictionary<int, string> lastHitBy = new Dictionary<int, string>();
        public static Dictionary<int, string> lastHitType = new Dictionary<int, string>();

        void Awake()
        {
            logPath = Path.Combine(Paths.GameRootPath, "logs", "events.log");
            Directory.CreateDirectory(Path.GetDirectoryName(logPath));
            Log("plugin_start", "MadLads Event Logger v1.0.0 loaded");

            var harmony = new Harmony("com.madladslab.eventlogger");
            harmony.PatchAll(Assembly.GetExecutingAssembly());
            Logger.LogInfo("MadLads Event Logger patched successfully");
        }

        public static void Log(string eventType, string data)
        {
            try
            {
                string line = string.Format("[MLEVENT] {0} | {1} | {2}",
                    DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"), eventType, data);
                lock (logLock)
                {
                    File.AppendAllText(logPath, line + "\n");
                }
            }
            catch { }
        }
    }

    // --- Track Damage Source (so we know who killed who) ---
    [HarmonyPatch(typeof(Character), "Damage")]
    static class CharacterDamagePatch
    {
        static void Prefix(Character __instance, HitData hit)
        {
            try
            {
                if (__instance == null || hit == null) return;
                int id = __instance.GetInstanceID();
                Character attacker = hit.GetAttacker();
                if (attacker != null)
                {
                    EventLoggerPlugin.lastHitBy[id] = attacker.GetHoverName();
                    EventLoggerPlugin.lastHitType[id] = attacker.IsPlayer() ? "player" : "creature";
                }
            }
            catch { }
        }
    }

    // --- Player/Creature Death ---
    [HarmonyPatch(typeof(Character), "OnDeath")]
    static class CharacterOnDeathPatch
    {
        static string[] bossNames = new string[] {
            "eikthyr", "elder", "bonemass", "moder", "yagluth", "queen", "fader"
        };

        static void Prefix(Character __instance)
        {
            try
            {
                if (__instance == null) return;

                string victimName = __instance.GetHoverName();
                bool isPlayer = __instance.IsPlayer();
                string victimType = isPlayer ? "player" : "creature";

                int id = __instance.GetInstanceID();
                string attackerName = "unknown";
                string attackerType = "unknown";

                if (EventLoggerPlugin.lastHitBy.ContainsKey(id))
                {
                    attackerName = EventLoggerPlugin.lastHitBy[id];
                    attackerType = EventLoggerPlugin.lastHitType.ContainsKey(id) ?
                        EventLoggerPlugin.lastHitType[id] : "unknown";
                    EventLoggerPlugin.lastHitBy.Remove(id);
                    EventLoggerPlugin.lastHitType.Remove(id);
                }

                Vector3 pos = __instance.transform.position;
                string posStr = string.Format("{0:F0},{1:F0},{2:F0}", pos.x, pos.y, pos.z);

                EventLoggerPlugin.Log("death",
                    string.Format("victim={0}|victim_type={1}|killer={2}|killer_type={3}|pos={4}",
                    victimName, victimType, attackerName, attackerType, posStr));

                // Boss kill detection
                if (!isPlayer)
                {
                    string nameLower = __instance.m_name != null ? __instance.m_name.ToLower() : "";
                    foreach (string boss in bossNames)
                    {
                        if (nameLower.Contains(boss))
                        {
                            EventLoggerPlugin.Log("boss_kill",
                                string.Format("boss={0}|killed_by={1}|pos={2}",
                                victimName, attackerName, posStr));
                            break;
                        }
                    }
                }
            }
            catch { }
        }
    }

    // --- Random Events / Raids ---
    [HarmonyPatch(typeof(RandEventSystem), "SetActiveEvent")]
    static class RandEventPatch
    {
        static void Postfix(RandomEvent ___m_activeEvent)
        {
            try
            {
                if (___m_activeEvent != null)
                {
                    Vector3 pos = ___m_activeEvent.m_pos;
                    EventLoggerPlugin.Log("raid_start",
                        string.Format("event={0}|pos={1:F0},{2:F0},{3:F0}",
                        ___m_activeEvent.m_name, pos.x, pos.y, pos.z));
                }
                else
                {
                    EventLoggerPlugin.Log("raid_end", "event_ended");
                }
            }
            catch { }
        }
    }

    // --- Structure Placement ---
    [HarmonyPatch(typeof(Player), "PlacePiece")]
    static class PlacePiecePatch
    {
        static void Postfix(Player __instance, Piece piece, bool __result)
        {
            try
            {
                if (!__result || piece == null || __instance == null) return;
                string playerName = __instance.GetHoverName();
                string pieceName = piece.m_name;
                EventLoggerPlugin.Log("piece_place",
                    string.Format("player={0}|piece={1}", playerName, pieceName));
            }
            catch { }
        }
    }

    // --- World Save ---
    [HarmonyPatch(typeof(ZNet), "SaveWorld")]
    static class WorldSavePatch
    {
        static void Postfix(bool sync)
        {
            try
            {
                EventLoggerPlugin.Log("world_save", string.Format("sync={0}", sync));
            }
            catch { }
        }
    }
}
