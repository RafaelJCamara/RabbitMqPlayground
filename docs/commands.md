<!-- Generated from the command registry in @rmq/domain. Do not edit by hand: run `npm run docs:generate` in web/. -->

# Command reference

The commands of the command bar (`/` or Ctrl/Cmd+K), described in
[ADR-0011](adr/0011-explicit-linking-and-command-layer.md) and [ADR-0025](adr/0025-the-command-grammar.md). They model RabbitMQ 4.3.

## Writing commands

- A command is one line. Several, with `;` between them, are one change, and undo takes them back together.
- A name, a key or a value is written as it is, unless it has a space, a `;`, a `"`, an `=`, a `(`, a `)` or a `->` in it.
  Then it is written in double quotes, with `\"` and `\\` inside, as in `bind "my exchange" -> "my queue"`. The empty name,
  which is the default exchange, is `""`.
- A queue and an exchange may have the same name. Where a command takes either, say which: `queue:orders` or
  `exchange:orders`. A producer is `producer:name` and a consumer `consumer:name`, and `canvas` in `set` is the canvas
  itself, so a queue that is called that is `queue:canvas`.
- A header value is typed by how it is written: `"1"` is a string, `1` an integer, `1.0` a float, `true` and `false` are
  booleans, and any other bare word is a string. An integer has to be a whole number that a JavaScript number holds
  exactly, from -9007199254740991 to 9007199254740991 ([ADR-0023](adr/0023-header-integers-are-limited-to-safe-integers.md)).
- `exists(name)` asks only for a header to be there, whatever its value. A header that is called `key` or `x-match` is
  written with its name in quotes, `"key"=1`, so that it is not taken for the option of that name.
- `->` goes from where a message leaves to where it goes, and the spaces around it are not needed.

## `add consumer`

Puts a consumer on the canvas. It consumes from nothing until it is subscribed to a queue.

**Syntax:** `add consumer <name>`

**Examples:**

```
add consumer logger
```

## `add producer`

Puts a producer on the canvas. It publishes nothing and to nothing until it is set up and linked.

**Syntax:** `add producer <name>`

**Examples:**

```
add producer clock
```

## `batch`

Several commands, one after the other, as one change. Each is read against the canvas that the ones before it made, so a command can name what an earlier one declared. If one is refused the whole batch is, and undo takes all of it back at once. Drag-to-create is a batch.

**Syntax:** `<command>; <command>; ...`

**Examples:**

```
declare queue jobs; bind orders -> jobs key=job.#
```

## `bind`

Binds a queue or an exchange to an exchange. The key matters to a direct exchange and to a topic exchange, and the conditions to a headers exchange: a value written as `1` is an integer, as `1.0` a float, as `true` a boolean and as `"1"` a string, and `exists(name)` asks only for the header to be there. Binding what is bound changes nothing.

**Syntax:** `bind <exchange> -> <queue|exchange> [key=<text>] [x-match=all|any|all-with-x|any-with-x] [<header>=<value> | exists(<header>)]...`

**Examples:**

```
bind orders -> archive key=order.#
bind docs -> billing x-match=all format=pdf size=10 exists(author)
```

## `clear`

Takes everything off the canvas. Its vhost and its settings stay, and undo brings everything back. It takes no arguments.

**Syntax:** `clear`

**Examples:**

```
clear
```

## `clear messages`

Takes every message out of the simulation: the ones on their way, in the queues and in the consumers. The canvas, the producers that repeat and the counters are as they were.

**Syntax:** `clear messages`

**Examples:**

```
clear messages
```

## `declare exchange`

Puts an exchange on the canvas. A name may not be empty or start with `amq.`. If an exchange of that name is there, a declaration that says the same changes nothing, as on a broker, and one that says another type or flag is refused, because a broker does not change an exchange that it has: use `set` for that.

**Syntax:** `declare exchange <name> type=direct|fanout|topic|headers [durable=true|false] [auto-delete=true|false] [internal=true|false]`

**Examples:**

```
declare exchange events type=topic
declare exchange audit type=fanout durable=false auto-delete=true
```

## `declare queue`

Puts a queue on the canvas. A queue that is not durable is refused, as RabbitMQ 4.3 refuses it, because every queue here has to be durable. Declaring a queue that is there changes nothing, as on a broker. Quorum queues and streams arrive in M4.

**Syntax:** `declare queue <name> [durable=true|false] [type=classic]`

**Examples:**

```
declare queue jobs
```

## `delete`

Takes an element off the canvas, with what hangs on it: the bindings of an exchange or a queue, the link of a producer that publishes to it, and the subscriptions of consumers to a queue.

**Syntax:** `delete <element>`

**Examples:**

```
delete archive
```

## `help`

Says what a command does and how it is written, with examples. Without a command it lists them all. It changes nothing, and it cannot be one of several commands.

**Syntax:** `help [<command>]`

**Examples:**

```
help
help bind
help declare queue
```

## `layout`

Puts every node in its place, from left to right in the way that a message travels: producers, exchanges, queues, consumers.

**Syntax:** `layout`

**Examples:**

```
layout
```

## `link`

Points a producer at the exchange or the queue that it publishes to. A queue is reached through the default exchange. A producer has one target, so linking it again changes it, and an internal exchange is refused.

**Syntax:** `link <producer> -> <exchange|queue>`

**Examples:**

```
link sender -> archive
```

## `move`

Puts a node somewhere on the canvas. A coordinate that is left out stays as it was.

**Syntax:** `move <element> [x=<number>] [y=<number>]`

**Examples:**

```
move billing x=640 y=120
```

## `move label`

Puts the label of an edge somewhere along it: 0 is at its start, where the message leaves, and 1 at its end. The edge goes from a producer to what it publishes to, from an exchange to what it is bound to, or from a queue to a consumer.

**Syntax:** `move label <element> -> <element> at=<0 to 1>`

**Examples:**

```
move label orders -> billing at=0.25
```

## `pause`

Stops the virtual clock: nothing moves until it is played or stepped, and what is in flight stays where it is.

**Syntax:** `pause`

**Examples:**

```
pause
```

## `play`

Lets the virtual clock run, so that messages move. It runs at the speed that was set, and starts running when the page opens.

**Syntax:** `play`

**Examples:**

```
play
```

## `publish`

Sends a message now. A producer sends the message that it has, as many times as its burst says, so it is told nothing more: change what it sends with `set`. An exchange is sent one message, with the key, the payload and the headers that are given, from no producer, which is a way to try a route. Nothing is sent when a producer has nowhere to send to, and an internal exchange is refused.

**Syntax:** `publish <producer|exchange> [key=<text>] [payload=<text>] [header:<name>=<value>...]`

**Examples:**

```
publish sender
publish orders key=order.created payload=hello header:format=pdf
```

## `purge`

Takes the ready messages out of a queue, as a broker does. The messages that consumers hold and have not acknowledged stay with them, and the canvas is as it was.

**Syntax:** `purge <queue>`

**Examples:**

```
purge billing
```

## `redo`

Does again the change that the last undo took back.

**Syntax:** `redo`

**Examples:**

```
redo
```

## `rename`

Gives an element another name. Every binding, link and subscription keeps pointing at it, because they hold its id. The new name has to be one that a declaration would take.

**Syntax:** `rename <element> <new name>`

**Examples:**

```
rename billing invoices
```

## `reset counters`

Sets the counters on the nodes to zero: what was sent, routed, found unroutable, given and finished with. The messages are as they were.

**Syntax:** `reset counters`

**Examples:**

```
reset counters
```

## `set`

Sets attributes of an element, or of the canvas. A queue that is not durable is refused, as it is when it is declared. An exchange cannot become internal while a producer publishes to it, and cannot become a topic exchange while a binding of it has a key that a topic exchange refuses. A producer's message headers are set one at a time, as `header:name=value`, with the value typed as in `bind`.

**Syntax:** `set <element|canvas> <attribute>=<value>...   (exchange: type, durable, auto-delete, internal · queue: durable · producer: payload, key, burst, every, repeat, header:<name> · consumer: ack, prefetch, processing · canvas: default-exchange, seed, publish-ms, broker-ms, deliver-ms)`

**Examples:**

```
set orders type=direct
set billing durable=true
set sender payload="Hello, world" key=order.created burst=3 every=500 repeat=true header:format=pdf
set worker ack=manual prefetch=5 processing=250
set canvas default-exchange=true
```

## `share`

Opens the panel that makes a link to the canvas, and to the messages that are queued if you want them. Anyone who has the link can read the whole canvas, with every name in it, and what they change is theirs. It changes nothing, and it cannot be one of several commands.

**Syntax:** `share`

**Examples:**

```
share
```

## `speed`

How fast the virtual clock runs, from a quarter to four times. At 1 a virtual millisecond passes for each real one, so the legs that a message takes (500 ms from a producer, 300 ms in the broker, 500 ms to a consumer, by default) take that long.

**Syntax:** `speed <0.25 to 4>`

**Examples:**

```
speed 2
speed 0.25
```

## `step`

Runs the one event that is next, and moves the clock to it. A step is a whole event, such as the arrival of a message at an exchange, and not a hop: routing is decided at once.

**Syntax:** `step`

**Examples:**

```
step
```

## `subscribe`

Makes a consumer consume from a queue. A consumer may consume from several queues.

**Syntax:** `subscribe <consumer> <queue>`

**Examples:**

```
subscribe worker archive
```

## `unbind`

Takes a binding off, the one with exactly this key and these conditions. If there is none, nothing changes, as on a broker.

**Syntax:** `unbind <exchange> -> <queue|exchange> [key=<text>] [x-match=all|any|all-with-x|any-with-x] [<header>=<value> | exists(<header>)]...`

**Examples:**

```
unbind orders -> billing key=order.*
```

## `undo`

Takes back the last change to the canvas, all of a batch at once. It restores the design and not the simulation: a queue that comes back is empty.

**Syntax:** `undo`

**Examples:**

```
undo
```

## `unlink`

Takes the target off a producer, so that it publishes to nothing.

**Syntax:** `unlink <producer>`

**Examples:**

```
unlink sender
```

## `unset`

Takes headers off the message of a producer.

**Syntax:** `unset <producer> header:<name>...`

**Examples:**

```
unset sender header:n
```

## `unsubscribe`

Stops a consumer consuming from a queue.

**Syntax:** `unsubscribe <consumer> <queue>`

**Examples:**

```
unsubscribe worker billing
```
