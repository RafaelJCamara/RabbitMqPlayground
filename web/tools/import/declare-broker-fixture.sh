#!/usr/bin/env bash
# The topology behind the broker's files in fixtures/import (ADR-0111). To record them again:
#
#   docker run -d --rm --name rmq-import-fixture -p 15679:15672 rabbitmq:4.3-management
#   bash tools/import/declare-broker-fixture.sh
#   curl -u guest:guest http://localhost:15679/api/definitions      > the full export (pretty-print it without JSON.parse, which turns 1.0 into 1)
#   curl -u guest:guest http://localhost:15679/api/definitions/%2F  > fixtures/import/broker-4.3-one-vhost.definitions.json
#   docker stop rmq-import-fixture
#
# The password hashes of the full export are replaced with "removed-from-the-fixture": they are of throwaway users, and a scanner would flag them.
set -euo pipefail
API=http://localhost:15679/api
put() { curl -sf -u guest:guest -X PUT -H 'content-type: application/json' "$API/$1" -d "$2" -o /dev/null -w "%{http_code} PUT $1\n"; }
post() { curl -sf -u guest:guest -X POST -H 'content-type: application/json' "$API/$1" -d "$2" -o /dev/null -w "%{http_code} POST $1\n"; }

put vhosts/shop '{}'
put users/learner '{"password":"secret","tags":""}'
put permissions/%2F/learner '{"configure":".*","write":".*","read":".*"}'
put policies/%2F/cap-billing '{"pattern":"^billing$","definition":{"max-length":1000},"apply-to":"queues"}'

# The default vhost: what a learner's canvas would have, and what the simulator does not model.
put exchanges/%2F/orders '{"type":"topic","durable":true,"auto_delete":false,"internal":false,"arguments":{}}'
put exchanges/%2F/docs '{"type":"headers","durable":true,"auto_delete":false,"internal":false,"arguments":{}}'
put exchanges/%2F/audit '{"type":"fanout","durable":true,"auto_delete":false,"internal":false,"arguments":{"alternate-exchange":"orders"}}'
put exchanges/%2F/hidden '{"type":"direct","durable":true,"auto_delete":true,"internal":true,"arguments":{}}'
put queues/%2F/billing '{"durable":true,"auto_delete":false,"arguments":{"x-queue-type":"classic"}}'
put queues/%2F/shipping '{"durable":true,"auto_delete":false,"arguments":{"x-queue-type":"quorum"}}'
put queues/%2F/archive '{"durable":true,"auto_delete":false,"arguments":{"x-queue-type":"classic","x-message-ttl":60000}}'
put queues/%2F/history '{"durable":true,"auto_delete":false,"arguments":{"x-queue-type":"stream"}}'
post bindings/%2F/e/orders/q/billing '{"routing_key":"order.*.billing","arguments":{}}'
post bindings/%2F/e/orders/q/shipping '{"routing_key":"order.#","arguments":{}}'
post bindings/%2F/e/orders/e/audit '{"routing_key":"#","arguments":{}}'
post bindings/%2F/e/audit/q/history '{"routing_key":"","arguments":{}}'
post bindings/%2F/e/docs/q/archive '{"routing_key":"","arguments":{"x-match":"any","format":"pdf","pages":10,"ratio":1.0,"draft":false}}'
post bindings/%2F/e/amq.topic/q/billing '{"routing_key":"legacy.#","arguments":{}}'

# Another vhost, which a canvas of "/" leaves out.
put exchanges/shop/carts '{"type":"direct","durable":true,"auto_delete":false,"internal":false,"arguments":{}}'
put queues/shop/checkout '{"durable":true,"auto_delete":false,"arguments":{"x-queue-type":"classic"}}'
post bindings/shop/e/carts/q/checkout '{"routing_key":"checkout","arguments":{}}'
