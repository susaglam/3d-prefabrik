const paths = {
 sparkle:'M11 3l1.8 4.9L17.7 9.7l-4.9 1.8L11 16.4l-1.8-4.9L4.3 9.7l4.9-1.8ZM18.5 14.5l.9 2.3 2.3.9-2.3.9-.9 2.3-.9-2.3-2.3-.9 2.3-.9Z',
 arrow:'M5 12h14m-5-5 5 5-5 5',back:'M19 12H5m5-5-5 5 5 5',check:'m5 12 4 4L19 6',close:'m6 6 12 12M6 18 18 6',
 save:'M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12l4 4v12a2 2 0 0 1-2 2ZM7 3v6h10V3M7 21v-8h10v8',
 share:'M12 16V3m-4 4 4-4 4 4M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7',
 camera:'M4 8h3l2-3h6l2 3h3v11H4ZM12 17a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z',
 rotate:'M3 10a9 9 0 1 1 1 8M3 4v6h6',expand:'M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5',
 ruler:'m3 16 13-13 5 5L8 21ZM7 12l2 2m1-5 2 2m1-5 2 2',
 cube:'m12 3 9 5v9l-9 5-9-5V8Zm0 19V12M3 8l9 4 9-4M7 5l9 5',
 plan:'M4 3h16v18H4ZM4 15h5v6M14 3v7h6',sun:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm0-6v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1',
 info:'M12 8h.01M11 12h1v5m0-15a10 10 0 1 0 0 20 10 10 0 0 0 0-20',
 home:'m3 10 9-7 9 7v11H3Zm6 11v-8h6v8',leaf:'M20 3C8 2 1 9 5 16s16 3 15-13ZM4 21l10-12',
 shield:'M12 3 3 7v6c0 5 9 9 9 9s9-4 9-9V7Zm-5 9 3 3 6-6',
 download:'M12 3v12m-5-5 5 5 5-5M4 15v6h16v-6',plus:'M12 5v14M5 12h14',minus:'M5 12h14',
 chevron:'m9 5 7 7-7 7',mail:'M3 5h18v14H3Zm0 0 9 8 9-8',phone:'M5 3h4l2 5-3 2a15 15 0 0 0 6 6l2-3 5 2v4c0 4-10 1-15-4S1 3 5 3Z',
 edit:'m15 4 5 5M4 20l5-1L21 7l-5-5L4 14ZM12 21h9',eye:'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Zm10-3a3 3 0 1 0 0 6 3 3 0 0 0 0-6',
 list:'M9 6h12M9 12h12M9 18h12M3 6h1m-1 6h1m-1 6h1',lock:'M5 10h14v11H5Zm3 0V6a4 4 0 0 1 8 0v4',
 clock:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 4v5l3 2',alert:'m12 3 10 18H2Zm0 6v5m0 3v.1',
 roof:'m2 13 10-9 10 9M5 10v10h14V10',light:'M9 18h6m-5 3h4M8 14a6 6 0 1 1 8 0l-1 2H9Z',
 undo:'M3 10h10a7 7 0 0 1 7 7v3M8 5l-5 5 5 5', copy:'M9 9h12v12H9ZM15 9V3H3v12h6',
 switch:'M7 3h10v18H7ZM10 7h4v5h-4Zm0 10h4',dimmer:'M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10Zm0 0V3M4 4l2 2m12-2-2 2M2 12h2m16 0h2',
 tree:'m12 3-7 9h3l-4 6h16l-4-6h3Zm0 15v4',floor:'m12 3 10 5-10 5L2 8Zm-10 9 10 5 10-5M2 16l10 5 10-5',
 sliders:'M4 7h16M4 12h16M4 17h16M14 4.5v5M8 9.5v5M16 14.5v5',
 // The phone's fold-away camera tools (2.10.7): the plain three-line menu mark everybody reads as "more here".
 menu:'M4 7h16M4 12h16M4 17h16',
 /* --- Scene toolbar, redesigned 2.9.3 -------------------------------------------------------------
    The bottom-left toolbar had two glyphs that both read as a house outline at 20 px ('home' for the
    house-and-garden dialog, 'roof' for the roof toggle), so the two buttons were told apart by position
    only. Every toolbar button now has a mark that says what the button does. The older names above are
    kept because they are a generic set other code may still reach for; nothing here repurposes one. */
 // Standpunten: a camera eye at the left whose field of view closes exactly on the volume it is aimed at — a
 // viewpoint, not a photo. Rays that overshoot the volume read as a megaphone; these stop on its edge.
 viewpoint:'M6.2 12a2.2 2.2 0 1 1-4.4 0 2.2 2.2 0 1 1 4.4 0M6.4 10.9 14 7.4M6.4 13.1 14 16.6M14 6.6h6.6v10.8H14z',
 // Woning en tuin: house with a garden — ground line and a tree, so it cannot be mistaken for the roof toggle.
 houseGarden:'M2.4 20.2h19.2M3.3 11.2 8 7l4.7 4.2M4.9 10.4v9.8M11.1 10.4v9.8M18 20.2v-4M21.1 12.6a3.1 3.1 0 1 1-6.2 0 3.1 3.1 0 1 1 6.2 0',
 // Materiaal van dichtbij: a sample of the wall (brick bond) under a magnifier, not a generic cube.
 material:'M3 4h10v10H3zM3 7.3h10M3 10.6h10M8 4v3.3M5.5 7.3v3.3M21.6 16.8a4.4 4.4 0 1 1-8.8 0 4.4 4.4 0 1 1 8.8 0M20.4 19.9 22.3 21.8',
 // Maatlijnen: a real dimension line — two extension ticks, one measure line, two arrow heads.
 dimension:'M4 6v12M20 6v12M5.6 12h12.8M8.1 9.5 5.6 12l2.5 2.5M15.9 9.5 18.4 12l-2.5 2.5',
 // Dak tonen: the roof slab closed on the walls. Its pair below shows the same building with the slab lifted off.
 roofOn:'M3.4 8.4h17.2v2.7H3.4zM6.1 11.1v9.3M17.9 11.1v9.3M6.1 20.4h11.8',
 // Dak verbergen: the same slab lifted clear of an open box, with the lift arrow in the gap.
 roofOff:'M3.4 3.6h17.2v2.7H3.4zM6.1 20.4v-8.6h11.8v8.6M6.1 20.4h11.8M12 10.8V7.6M10.4 9.2 12 7.6l1.6 1.6',
 // Camera herstellen: aim the view back at the middle — a sight, not the generic undo arrow.
 recenter:'M12 3.6v3.2M12 17.2v3.2M3.6 12h3.2M17.2 12h3.2M17.1 12a5.1 5.1 0 1 1-10.2 0 5.1 5.1 0 1 1 10.2 0M13 12a1 1 0 1 1-2 0 1 1 0 1 1 2 0'
};
/** Every glyph in the set, in declaration order — used by the contact-sheet tool so it can never miss one. */
export const iconNames=Object.freeze(Object.keys(paths));
export function icon(name, cls='') { return `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] || paths.info}"/></svg>`; }

/** A roof diagram with one polygon per pane and a matching end profile. */
// Isometric roof-light icons live in their own module; re-exported for the form.
export {rooflightIcon} from './rooflight_icons.js';
// Isometric front-opening (kozijn) icons, same style; re-exported for the form.
export {openingIcon} from './opening_icons.js';
// Front-elevation drawings of the three house types and the alignment mark, for the "Woning en tuin" tiles.
export {houseTypeIcon,alignmentIcon} from './house_type_icons.js';
