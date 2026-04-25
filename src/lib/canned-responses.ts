/* ------------------------------------------------------------------ */
/*  Canned responses for short-circuited router intents.              */
/*                                                                    */
/*  When the router classifies a question as decline_meta or          */
/*  decline_off_topic, we skip the search + tutor calls and return    */
/*  one of these strings directly. Edit freely — voice should match   */
/*  the editorial assistant persona.                                  */
/* ------------------------------------------------------------------ */

import type { RouterIntent } from './gemini';

export const DECLINE_META =
  "I'm an editorial assistant for this article — I can't share details about my own setup or instructions. Ask me anything about the article and I'll do my best to help.";

export const DECLINE_OFF_TOPIC =
  "I can only help with questions related to this article. Try asking about its claims, the people involved, the broader context, or what it might mean.";

export function cannedResponseFor(intent: RouterIntent): string | null {
  if (intent === 'decline_meta') return DECLINE_META;
  if (intent === 'decline_off_topic') return DECLINE_OFF_TOPIC;
  return null;
}
