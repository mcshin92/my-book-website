const { app } = require("@azure/functions");
const { TableClient } = require("@azure/data-tables");
const crypto = require("crypto");

const TABLE_NAME = "Guestbook";
const PARTITION_KEY = "main";
const MAX_ITEMS = 200;

function jsonResponse(status, data) {
  return {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    },
    body: JSON.stringify(data)
  };
}

function getTableClient() {
  const connectionString =
    process.env.GUESTBOOK_STORAGE_CONNECTION_STRING;

  if (!connectionString) {
    throw new Error("Storage connection string is not configured.");
  }

  return TableClient.fromConnectionString(
    connectionString,
    TABLE_NAME
  );
}

function normalizeText(value) {
  return typeof value === "string"? value.trim(): "";
}

app.http("guestbook", {
  methods: ["GET", "POST"],
  authLevel: "anonymous",
  route: "guestbook",

  handler: async (request, context) => {
    try {
      const tableClient = getTableClient();

      /*
       * GET /api/guestbook
       * 최근 방명록을 조회합니다.
       */
      if (request.method === "GET") {
        const items = [];

        const entities = tableClient.listEntities({
          queryOptions: {
            filter: `PartitionKey eq '${PARTITION_KEY}'`
          }
        });

        for await (const entity of entities) {
          items.push({
            id: entity.rowKey,
            name: entity.name,
            message: entity.message,
            createdAt: entity.createdAt
          });

          if (items.length >= MAX_ITEMS) {
            break;
          }
        }

        items.sort(
          (a, b) =>
            new Date(b.createdAt).getTime() -
            new Date(a.createdAt).getTime()
        );

        return jsonResponse(200, { items });
      }

      /*
       * POST /api/guestbook
       * 새로운 방명록을 저장합니다.
       */
      if (request.method === "POST") {
        let body;

        try {
          body = await request.json();
        } catch {
          return jsonResponse(400, {
            error: "올바른 요청 형식이 아닙니다."
          });
        }

        // 숨겨진 필드가 입력되면 봇으로 판단합니다.
        if (normalizeText(body.website)) {
          return jsonResponse(201, { success: true });
        }

        const name = normalizeText(body.name);
        const message = normalizeText(body.message);

        if (!name ||!message) {
          return jsonResponse(400, {
            error: "이름과 내용을 모두 입력해 주세요."
          });
        }

        if (name.length > 30) {
          return jsonResponse(400, {
            error: "이름은 30자 이하로 입력해 주세요."
          });
        }

        if (message.length > 500) {
          return jsonResponse(400, {
            error: "내용은 500자 이하로 입력해 주세요."
          });
        }

        const now = new Date();

        /*
         * Table Storage는 RowKey 순서로 조회되므로,
         * 역순 타임스탬프를 사용해 새 글이 앞에 오도록 합니다.
         */
        const reverseTimestamp =
          9999999999999 - now.getTime();

        const rowKey =
          String(reverseTimestamp).padStart(13, "0") +
          "-" +
          crypto.randomUUID();

        const entity = {
          partitionKey: PARTITION_KEY,
          rowKey,
          name,
          message,
          createdAt: now.toISOString()
        };

        await tableClient.createEntity(entity);

        return jsonResponse(201, {
          success: true,
          item: {
            id: rowKey,
            name,
            message,
            createdAt: entity.createdAt
          }
        });
      }

      return jsonResponse(405, {
        error: "지원하지 않는 요청입니다."
      });
    } catch (error) {
      context.error("Guestbook API error", error);

      return jsonResponse(500, {
        error: "방명록을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요."
      });
    }
  }
});