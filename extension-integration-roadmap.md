# Extension Integration Roadmap
A list of extensions that expose APIs that we want to integrate with Sting. This document will be used to record progress, problem areas, and future tasks.

## Soundboard+

## Rumble!

Implemented in schema version 1 using Rumble!'s documented player-metadata contract.

- `send-message`: enter, exit, or nearest-change; party target (`0000`) or resolved
  Sting audiences sent as individual direct messages.
- `roll-dice`: enter, exit, or nearest-change; party-visible Roll20-style notation.
- Execution is limited to one elected GM connection to prevent duplicate commands.
- Availability is manually enabled per scene because Rumble! has no readiness handshake.
- Rumble! exposes no result callback; rolls cannot feed conditional Sting behavior.
- Direct-message configuration is stored in shared detector metadata and is not secret.

## Embers

## Dice+

## JustDices

## Causality
Currently, Causality has no public API.

## Behaviors
Messaging exists, but no documented external API.
