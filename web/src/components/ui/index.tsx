// Shared UI primitives.
//
// Four sports were each rendering their own card, their own stat tile and their
// own section heading, with slightly different padding and type sizes every time.
// The result read as four apps behind one tab bar. These are the pieces they now
// share; anything sport-specific composes them rather than restyling from scratch.

//
// Fase 5: el fichero se partió por familias; este índice solo reexporta.

export * from './cards';
export * from './marks';
export * from './rows';
export * from './days';
export * from './states';
export * from './picks';
export * from './dashboard';
export * from './slate';
export * from './EnlacePartido';
export * from './Termino';
