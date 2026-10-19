// Whole-story plot validator: reads every scene together and reports cross-scene contradictions.
// Deterministic and independent of the model's self-assessment. Each issue names the affected scenes
// so correction can target them; the whole story is re-validated after every correction.
import { splitItems } from "./instructions";
import type { Issue } from "./validators";

type Scene = { num: number; body: string };

const OBJ = "(?:[a-z-]+\\s){0,2}?(?:core|crystal|key|battery|cell|orb|gem|chip|map|amulet|stone|artifact|artefact|potion|card|disk|disc|module|fuel\\s+rod|heart|seed|relic|shard|lens|gear)s?";
const CONSUME_ACTIVE = new RegExp(`\\b(?:insert|install|plug|slot|fit|feed|consume|destroy|shatter|smash|crush|burn|sacrifice|drain|spend|break|drop|throw|toss|lose|use[sd]?\\s+up|give|hand|lock)(?:s|es|ed|d|ing)?\\b[^.\\n]{0,40}?\\b(?:the|its|his|her|their|a|an)\\s+(${OBJ})\\b`, "gi");
const CONSUME_PASSIVE = new RegExp(`\\b(?:the|its|his|her|their)\\s+(${OBJ})\\s+(?:is\\s+|are\\s+|was\\s+)?(?:shatter|destroy|consum|burn(?:s|ed)?\\s+out|crumbl|dissolv|spent|used\\s+up|explod|melt|vanish|disintegrat|absorb)`, "gi");
const USE_AGAIN = /\b(hold|grab|pick(?:s|ed)?\s+up|clutch|carr(?:y|ies|ied)|insert|install|plug|slot|plac|use|raise|lift|activat|wield|reveal|pull(?:s|ed)?\s+out|take|offer|present)/i;
const RESTORE = /\b(another|second|new|spare|replacement|backup|duplicate|retriev|recover|reclaim|remov|extract|pull(?:s|ed|ing)?\b[^.\n]{0,30}?\b(?:back\s+)?out|(?:tak|get|bring)(?:s|es|ing)?\b[^.\n]{0,30}?\bback\b|repair|rebuil|recharg|restor|reform|regenerat|glu|piece[sd]?\s+together|rescu|found|find|returns?\s+it|takes?\s+(?:it\s+)?back|gets?\s+(?:it\s+)?back)/i;

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").replace(/s$/, "").trim();
const head = (s: string) => norm(s).split(" ").slice(-2).join(" ");
const sentences = (s: string) => s.split(/(?<=[.!?])\s+|\n+/).filter((x) => x.trim());

/** An object used up or locked away in one scene must not be used again later without a stated recovery. */
export function checkObjectReuse(scenes: Scene[]): Issue[] {
  const issues: Issue[] = [];
  const gone = new Map<string, number>();
  for (const sc of scenes) {
    // First: does this scene reuse something already gone?
    for (const [obj, at] of gone) {
      const re = new RegExp(`\\b(?:${obj.replace(/\s+/g, "\\s+")}|(?:the|its|his|her)\\s+${obj.split(" ").pop()})s?\\b`, "i");
      const hits = sentences(sc.body).filter((s) => re.test(s));
      if (!hits.length) continue;
      if (hits.some((s) => RESTORE.test(s)) || RESTORE.test(sc.body.slice(0, 400)) && re.test(sc.body.slice(0, 400))) { gone.delete(obj); continue; }
      if (hits.some((s) => USE_AGAIN.test(s))) {
        issues.push({ code: "plot_object_reuse", items: [at, sc.num], message: `Scene ${sc.num} uses the ${obj} again, but it was used up or locked away in scene ${at} and never recovered. Rewrite scene ${sc.num} (or scene ${at}) so the ${obj} is either recovered on screen first or a different, introduced object is used; then re-check scenes ${Math.max(1, at - 1)}–${sc.num + 1} for knock-on contradictions.` });
        gone.delete(obj);
      }
    }
    for (const re of [CONSUME_ACTIVE, CONSUME_PASSIVE]) for (const m of sc.body.matchAll(re)) { const o = head(m[1]); if (!gone.has(o)) gone.set(o, sc.num); }
  }
  return issues;
}

const CAM_UP = /\b(?:camera|shot|lens|drone)\b[^.\n]{0,40}?\b(?:tilt(?:s|ing)?\s+up|pan(?:s|ning)?\s+up|crane(?:s|d)?\s+up|boom(?:s)?\s+up|rises|rising|ascends|ascending|climbs|lifts|moves\s+up(?:ward)?|pulls?\s+up)/i;
const CAM_DOWN = /\b(?:camera|shot|lens|drone)\b[^.\n]{0,40}?\b(?:tilt(?:s|ing)?\s+down|pan(?:s|ning)?\s+down|crane(?:s|d)?\s+down|boom(?:s)?\s+down|descends|descending|drops|sinks|lowers|moves\s+down(?:ward)?|dips)/i;
const SUBJ_UP = /\b(?:climb(?:s|ing|ed)?(?!\s+down)|ascend(?:s|ing|ed)?|scal(?:es|ing|ed)|clamber(?:s|ing|ed)?\s+up|leap(?:s|ing|t)?\s+up|jump(?:s|ing|ed)?\s+up|fl(?:y|ies|ying|ew)\s+up|rocket(?:s|ing)?\s+up(?:ward)?|soar(?:s|ing)?)/i;
const SUBJ_DOWN = /\b(?:climb(?:s|ing|ed)?\s+down|descend(?:s|ing|ed)?|fall(?:s|ing)?|fell|drop(?:s|ping|ped)?\s+down|div(?:es|ing)|plung(?:es|ing)|slid(?:es|ing)?\s+down|rappel(?:s|ling)?)/i;
const CAM_JUSTIFIED = /\b(counter|opposite|contrast|reveal(?:s|ing)?\s+(?:the\s+)?(?:depth|drop|height|chasm|abyss)|vertigo|leaves?\s+\w+\s+behind)/i;

/** Camera movement in a scene must not contradict the movement it is meant to follow. */
export function checkCameraDirection(scenes: Scene[]): Issue[] {
  const issues: Issue[] = [];
  for (const sc of scenes) {
    if (CAM_JUSTIFIED.test(sc.body)) continue;
    const camUp = CAM_UP.test(sc.body), camDown = CAM_DOWN.test(sc.body);
    if (camUp === camDown) continue;
    const subject = sc.body.replace(new RegExp(CAM_UP.source, "gi"), " ").replace(new RegExp(CAM_DOWN.source, "gi"), " ");
    const up = SUBJ_UP.test(subject), down = SUBJ_DOWN.test(subject);
    if (up === down) continue;
    if ((camDown && up) || (camUp && down)) {
      issues.push({ code: "plot_camera_direction", items: [sc.num], message: `Scene ${sc.num}: the camera moves ${camDown ? "down" : "up"} while the character moves ${up ? "up (climbing)" : "down"}. Make the camera follow the action (${up ? "tilt/crane up" : "tilt/crane down"}) or state why it moves against it; keep scenes ${Math.max(1, sc.num - 1)} and ${sc.num + 1} consistent with the new framing.` });
    }
  }
  return issues;
}

const DISABLED = /\b(powers?\s+down|powered\s+down|shuts?\s+down|shut\s+down|goes\s+dark|went\s+dark|loses?\s+power|lost\s+power|battery\s+(?:dies|died|is\s+dead)|falls?\s+unconscious|knocked\s+(?:out|unconscious)|collapses?\s+(?:lifeless|motionless)|is\s+(?:trapped|captured|caged|chained|frozen\s+solid)|offline)\b/i;
const RECOVER = /\b(reboot|restart|wak(?:e|es|ing)|woke|powers?\s+(?:back\s+)?(?:on|up)|comes?\s+back\s+online|back\s+online|regain|recover|reviv|recharg|repair|restor|freed|frees|escap|rescu|breaks?\s+free|flicker(?:s|ing)?\s+(?:back\s+)?(?:on|to\s+life)|jolt(?:s|ed)?\s+(?:back\s+)?(?:awake|to\s+life)|spark(?:s|ed)?\s+(?:back\s+)?to\s+life|eyes\s+(?:glow|light)\s+(?:again|back))/i;
const CONTINUITY_LINE = /^\s*(?:[-*]\s*)?(?:\*\*)?(?:continuity|previous)\b/i;
// A sentinel/drone/guard shutting down is not the hero shutting down.
const OTHER_ACTOR = /\b(sentinel|drone|guard|enemy|villain|rival|thief|turret|bot\b|robots?\s+(?:guard|sentry)|security)\b/i;
const ACTIVE = /\b(runs?|sprints?|climbs?|jumps?|leaps?|fights?|walks?|flies|grabs?|races?|dashes|charges|speaks?|says|shouts)\b/i;
const LIMB = /\b(?:loses|lost|severs?|severed|rips?\s+off|torn\s+off|crushes|crushed|breaks|broke|snaps|snapped)\s+(?:his|her|its|their|the\s+robot's|\w+'s)\s+((?:left|right)\s+)?(arm|leg|hand|antenna|eye)\b/gi;

const WORN = "scarf|hat|cap|cape|cloak|helmet|backpack|jacket|coat|goggles|glasses|boots|mask|necklace|badge|bandana|hood|gloves?|armou?r|harness";
const TAKE_OFF = new RegExp(`\\b(?:takes?\\s+off|took\\s+off|remov(?:es|ed|ing)|hang(?:s|ing)?|hung|unwrap(?:s|ped)?|unti(?:es|ed)|gives?\\s+away|gave\\s+away|hands?\\s+(?:over\\s+)?|drap(?:es|ed)|lays?\\s+down|leav(?:es|ing)\\s+behind|left\\s+behind|sets?\\s+aside|loses?|lost|tears?|tore)\\b[^.\\n]{0,25}?\\b(?:his|her|its|their)\\s+((?:[a-z-]+\\s)?(?:${WORN}))\\b`, "gi");
const PUT_ON = /\b(puts?\s+(?:\w+\s+){0,3}on|wraps?|ties?|retie|grabs?|picks?\s+up|takes?\s+(?:\w+\s+){0,3}(?:back|from)|dons?|slips?\s+(?:\w+\s+){0,3}on|retriev|wear(?:s|ing)?\s+(?:it|\w+)\s+again|once\s+more\s+around)/i;

/** An accessory taken off in one scene cannot be worn later unless it is shown being put back on. */
export function checkWornItems(scenes: Scene[]): Issue[] {
  const issues: Issue[] = [];
  const off = new Map<string, number>();
  for (const sc of scenes) {
    for (const [item, at] of off) {
      const re = new RegExp(`\\b(?:his|her|its|their|the)\\s+(?:[a-z-]+\\s)?${item}\\b`, "i");
      const hits = sentences(sc.body).filter((x) => re.test(x));
      if (!hits.length) continue;
      if (hits.some((x) => PUT_ON.test(x))) { off.delete(item); continue; }
      issues.push({ code: "plot_object_reuse", items: [at, sc.num], message: `Scene ${sc.num} shows Bolt's ${item} on him again, but it was taken off in scene ${at} and never put back on. Show the ${item} being put back on (or keep it off) and re-check scenes ${at}–${Math.min(scenes[scenes.length - 1].num, sc.num + 1)}.`.replace("Bolt's", "the character's") });
      off.delete(item);
    }
    for (const m of sc.body.matchAll(TAKE_OFF)) off.set(m[1].toLowerCase().split(/\s+/).pop()!, sc.num);
  }
  return issues;
}

/** Disabled characters must be shown recovering before acting; lost limbs stay lost until repaired. */
export function checkCharacterState(scenes: Scene[]): Issue[] {
  const issues: Issue[] = [];
  for (let i = 0; i + 1 < scenes.length; i++) {
    const a = scenes[i], b = scenes[i + 1];
    const own = (body: string) => sentences(body.split("\n").filter((l) => !CONTINUITY_LINE.test(l)).join("\n")).filter((x) => !(OTHER_ACTOR.test(x) && !/\b(he|she|him|bolt)\b/i.test(x)));
    const lastSentences = own(a.body).slice(-3).join(" ");
    if (DISABLED.test(lastSentences) && !RECOVER.test(lastSentences) && !RECOVER.test(b.body) && ACTIVE.test(b.body)) {
      issues.push({ code: "plot_character_state", items: [a.num, b.num], message: `Scene ${a.num} ends with the character disabled ("${DISABLED.exec(lastSentences)![0]}"), but scene ${b.num} has them acting with no recovery shown. Add the recovery (reboot, rescue, escape…) at the start of scene ${b.num}.` });
    }
  }
  const lost = new Map<string, number>();
  for (const sc of scenes) {
    for (const [limb, at] of lost) {
      const re = new RegExp(`\\b(?:${limb.includes(" ") ? limb : `(?:left\\s+|right\\s+)?${limb}`})s?\\b`, "i");
      const hit = sentences(sc.body).find((s) => re.test(s) && /\b(rais|lift|grab|swing|punch|reach|wav|kick|run|point|grip|stomp|glow)/i.test(s));
      if (/\b(repair|replac|reattach|new|rebuil|weld|fix)/i.test(sc.body) && re.test(sc.body)) { lost.delete(limb); continue; }
      if (hit) { issues.push({ code: "plot_character_state", items: [at, sc.num], message: `Scene ${sc.num} uses the ${limb} that was lost in scene ${at} without any repair. Show the repair or keep it missing.` }); lost.delete(limb); }
    }
    for (const m of sc.body.matchAll(LIMB)) lost.set(`${m[1] ?? ""}${m[2]}`.toLowerCase().trim(), sc.num);
  }
  return issues;
}

const LOCATION = /^\s*(?:[-*]\s*)?\**\s*(?:location|setting|place)\s*\**\s*:\s*\**\s*(.+)$/im;
const TRANSITION = /\b(arriv|travel|journey|reach|enter|exit|leav|left|return|head(?:s|ed)?\s+(?:to|for|into)|walk|fl(?:y|ies|ew)|climb|descend|ride|drive|escap|later|meanwhile|after|then|soon|cut\s+to|emerg|follow|teleport|crash|fall|lands?|through)/i;
const words = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 3));

/** When scenes state a location, a change of location must be bridged by a transition. */
export function checkTransitions(scenes: Scene[]): Issue[] {
  const issues: Issue[] = [];
  for (let i = 1; i < scenes.length; i++) {
    const pa = LOCATION.exec(scenes[i - 1].body)?.[1], pb = LOCATION.exec(scenes[i].body)?.[1];
    if (!pa || !pb) continue;
    const wa = words(pa), wb = [...words(pb)];
    if (!wa.size || !wb.length || wb.some((w) => wa.has(w))) continue;
    const bridge = sentences(scenes[i - 1].body).slice(-2).join(" ") + " " + sentences(scenes[i].body.replace(LOCATION, "")).slice(0, 3).join(" ");
    if (!TRANSITION.test(bridge)) issues.push({ code: "plot_transition", items: [scenes[i - 1].num, scenes[i].num], message: `Scene ${scenes[i].num} moves from "${pa.trim()}" to "${pb.trim()}" with no transition explaining how the character got there. Add a causal bridge at the end of scene ${scenes[i - 1].num} or the start of scene ${scenes[i].num}.` });
  }
  return issues;
}

// Chronological object-state tracking: each key object has a state (held by the hero, stored/locked, left behind,
// taken by someone else) updated sentence by sentence; every change is attributed to the scene that makes it.
type ObjState = { kind: "held" | "stored" | "left" | "other"; at: number; where?: string };
const ACQUIRE = /\b(retriev|recover|reclaim|grab|snatch(?:es|ed|ing)?(?!\s+(?:it|the\s+\w+(?:\s+\w+)?)\s+(?:away\s+)?from\s+(?:him|her|bolt))|seiz|secur(?:es|ed|ing)|collect|pick(?:s|ed|ing)?\s+(?:it\s+)?up|lift(?:s|ed|ing)?\s+(?:it\s+)?(?:out|free|from)|pull(?:s|ed|ing)?\s+(?:it\s+)?(?:free|out|loose)|pry|pries|pried|wrench|extract|takes?\s+(?:back\s+)?(?:the|it)|took|catch(?:es)?|caught|unlock(?:s|ed)?[^.\n]{0,40}\b(?:and|then)\s+(?:takes?|grabs?|removes?)|remov(?:es|ed|ing)\s+(?:the|it)[^.\n]{0,30}\bfrom)/i;
const STORE = /\b(lock(?:s|ed|ing)?\s+(?:it\s+|the\s+[\w-]+(?:\s+[\w-]+)?\s+)?(?:away|inside|in|into)|seal(?:s|ed|ing)?\s+(?:it\s+)?(?:inside|in|into|away)|(?:is|remains|stays|sits|rests)\s+(?:locked|sealed|stored)|stor(?:es|ed|ing)\s|stash|plac(?:es|ed|ing)\s+(?:it|the\s+[\w-]+(?:\s+[\w-]+)?)\s+(?:back\s+)?(?:in|into|inside|on)\s+(?:the|a)\s+(vault|safe|case|pedestal|cradle|reactor|socket|chamber|container|pod|slot|console)|insert(?:s|ed|ing)?|install(?:s|ed|ing)?|slot(?:s|ted|ting)\s)/i;
const LEAVE = /\b(drop(?:s|ped|ping)?|leav(?:es|ing)\s+(?:it|the\s+[\w-]+(?:\s+[\w-]+)?)\s+behind|left\s+behind|abandon|los(?:es|ing)\s+(?:his\s+)?grip|knock(?:s|ed)?\s+(?:it\s+|the\s+[\w-]+(?:\s+[\w-]+)?\s+)?(?:out\s+of|from)|slips?\s+from|falls?\s+from\s+(?:his|her|its|bolt's))/i;
const OTHER = /\b(stol(?:e|en)|snatch(?:es|ed)?\s+(?:it|the\s+[\w-]+(?:\s+[\w-]+)?)\s+(?:away\s+)?from\s+(?:him|her|bolt)|hands?\s+(?:it|the\s+[\w-]+(?:\s+[\w-]+)?)\s+(?:over\s+)?to|gives?\s+(?:it|the\s+[\w-]+(?:\s+[\w-]+)?)\s+to|confiscat)/i;
const HOLD = /\b(hold(?:s|ing)?|held|clutch|cradl|carr(?:y|ies|ying|ied)|grip(?:s|ping)?|in\s+(?:his|her|its|bolt's)\s+(?:hand|hands|grip|arms|palm|claw|fist)|strapped\s+to|(?:on|across)\s+(?:his|her|its|bolt's)\s+back|in\s+(?:his|her|its|bolt's)\s+(?:backpack|pack|chest\s+compartment|compartment|pouch|case)|raises?|lifts?\s+(?:it|the)|tucked|hug)/i;
const RETRIEVE = /\b(retriev|recover|reclaim|snatch|seiz|pick(?:s|ed|ing)?\s+(?:it\s+)?up|pry|pries|pried|wrench|extract|grab)/i;
// "removes the core from his belt field" / "takes it out of his pack": a move within the hero's own possession.
const OWN_CONTAINER = /\b(?:from|out\s+of|off)\s+(?:his|her|its|their|bolt's)\b/i;
// Possession needs a person in the sentence ("Shields Holding, Core Stable" in a title is not someone holding it).
const HERO = /\b(he|she|his|her|him|bolt|bolt's|hands?|grip|arms)\b/i;
const MENTION_STATE = /\b(vault|safe|case|pedestal|cradle|reactor|socket|chamber|container|pod|stand|console|slot)\b/i;

/** Tracks every key object scene by scene and reports double retrievals, reappearances without a transition,
 *  and an object held while it is still locked away or with someone else. */
export function checkObjectStates(scenes: Scene[]): Issue[] {
  const issues: Issue[] = [];
  const objRe = new RegExp(`\\b(?:the|its|his|her|their|a|an)\\s+(${OBJ})\\b`, "gi");
  const keys = new Map<string, number>();
  for (const sc of scenes) for (const m of sc.body.matchAll(objRe)) { const k = head(m[1]).split(" ").pop()!; keys.set(k, (keys.get(k) ?? 0) + 1); }
  for (const [obj, n] of keys) {
    if (n < 3) continue;
    const word = obj.split(" ").pop()!;
    const re = new RegExp(`\\b${word}s?\\b`, "i");
    let st: ObjState | null = null;
    let reported = false;
    for (const sc of scenes) {
      if (reported) break;
      // "Continuity:" lines restate the previous scene; they don't change state.
      const lines = sc.body.split("\n").filter((l) => !/^\s*(?:[-*]\s*)?(?:\*\*)?(?:continuity|previous|hindi\s+dialogue|dialogue)\b/i.test(l)).join("\n");
      let acquiredHere = false, releasedHere = false;
      for (const s of sentences(lines)) {
        if (!re.test(s)) continue;
        if (OTHER.test(s)) { st = { kind: "other", at: sc.num }; releasedHere = true; continue; }
        if (STORE.test(s) && !ACQUIRE.test(s)) { st = { kind: "stored", at: sc.num, where: MENTION_STATE.exec(s)?.[1] }; releasedHere = true; continue; }
        if (LEAVE.test(s) && !ACQUIRE.test(s)) { st = { kind: "left", at: sc.num }; releasedHere = true; continue; }
        if (ACQUIRE.test(s)) {
          if (st?.kind === "held" && st.at < sc.num && !releasedHere && RETRIEVE.test(s) && !OWN_CONTAINER.test(s)) {
            issues.push({ code: "plot_object_state", items: [st.at, sc.num], message: `Scene ${sc.num} has the ${obj} retrieved again, but it was already recovered in scene ${st.at} and never lost, dropped, stored or taken in between. Either show how it was lost after scene ${st.at}, or make scene ${sc.num} continue with the ${obj} already in hand; then re-check scenes ${st.at}–${sc.num + 1}.` });
            reported = true; break;
          }
          st = { kind: "held", at: sc.num }; acquiredHere = true; continue;
        }
        if (HOLD.test(s) && HERO.test(s) && st && st.kind !== "held" && !acquiredHere && st.at < sc.num) {
          const was = st.kind === "stored" ? `locked/stored${st.where ? ` in the ${st.where}` : ""}` : st.kind === "left" ? "left behind" : "with someone else";
          issues.push({ code: "plot_object_state", items: [st.at, sc.num], message: `Scene ${sc.num} shows the ${obj} in the character's possession, but since scene ${st.at} it is ${was} and no scene shows it being recovered. Add the retrieval on screen (at the end of scene ${sc.num - 1} or the start of scene ${sc.num}) or keep it where it was; then re-check scenes ${st.at}–${sc.num + 1}.` });
          reported = true; break;
        }
      }
    }
  }
  return issues;
}

/** Runs every whole-story check, including short two-scene continuity boundaries. */
export function checkPlot(text: string, noun: string | null): Issue[] {
  const body = text.replace(/```[\s\S]*?```/g, (m) => m.replace(/^```[^\n]*\n?|```$/g, ""));
  const scenes = splitItems(body, noun ?? "scene");
  if (!scenes.length) return [];
  return [...checkObjectReuse(scenes), ...checkObjectStates(scenes), ...checkWornItems(scenes), ...checkCameraDirection(scenes), ...checkCharacterState(scenes), ...checkTransitions(scenes)];
}
