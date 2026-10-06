/**
 * What started a command (ADR-0031, ADR-0046). Every apply says, so that the log of equivalent commands can say what the learner used, and S6
 * can follow the engine. `gesture` is a pointer on the canvas or in the toolbox, `key` a key, `inspector` a form, `toolbar` a button of the
 * top bar, `menu` a context menu or the one that a drop on nothing opens, and `typed` a line of the command bar.
 */
export type CommandOrigin = 'gesture' | 'key' | 'inspector' | 'toolbar' | 'menu' | 'typed';
