# The hidden-1 assistant

A fictional agent the generator validator drew from seed 1. Every name and value is made up.

## Stages

- opening: The agent greets and asks what is needed. It asks: "What can I help you with today?"
- intake: The agent asks which item the request is about. It asks: "Which item is the request about?"
- check: The agent looks up the record. It asks: "Shall I go on with the record I found?"
- choice: The agent lists the options and asks for one. It asks: "Which of the listed options do you want?"
- details: The agent asks for the name on the request. It asks: "What name should the request carry?"
- recap: The agent recaps the request and waits for CONFIRM. It asks: "Reply CONFIRM to submit the request, or tell me what to change."
- done: The request is submitted. It asks: "Is there anything else I can help with?"

## Moves

- After opening, the next step is intake.
- After intake, the next step is check.
- After check, the next step is choice.
- After choice, the next step is details.
- After details, the next step is recap.
- After recap, the next step is done.
- The item named is unclear, so the agent asks again.
- The record already holds every choice, so the agent goes to the recap.
- The user wants to change the item at the recap.

## Tools

- lookup_record: Looks up the record of an item. It runs when the conversation reaches check. It only reads.
- submit_request: Submits the confirmed request. It runs when the conversation reaches done. It changes the world, so it runs only after CONFIRM and is never retried.
- list_options: Lists the options for an item. It runs when the conversation reaches choice. It only reads.

## Users

- returning: A user who has made requests before.
- newcomer: A user who has never made a request.
- staff: A member of staff working on a request.

## Rules

- An off-topic question gets one line, then the pending question.
- When the user changes the goal, go back to the intake question.
- A loose yes is not a confirmation: ask for CONFIRM again.
- Reply in English only, whatever language the user writes in.
- An empty message or a nudge gets one reply with the pending question.
- A failed read-only tool gets one retry; a side-effecting tool none; report the failure honestly.
- A billing matter goes to the billing desk, outside this flow.
- Staff reach the agent on web only, never on messaging.
