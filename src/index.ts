import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { BodyData } from "hono/utils/body";

type JsonResponse = {
  status: number;
  message: string;
};

const STATUS_MESSAGES = {
  created: {
    status: 201,
    message: "ファイルのアップロードが完了しました",
  },
  unauthorized: {
    status: 401,
    message: "APIキーで認証する必要があります",
  },
  not_found: {
    status: 404,
    message: "指定したファイルは見当たりませんでした",
  },
  method_not_allowed: {
    status: 405,
    message: "PUT以外の操作を行なうことはできません",
  },
  conflict: {
    status: 409,
    message: "同名のファイルが既に存在します。別の名前を検討してください",
  },
  failed_file_save: {
    status: 500,
    message: "ファイルの保存に失敗しました",
  },
  internal_server_error: {
    status: 500,
    message: "不明なエラーが発生しました。運営者に問い合わせてください",
  },
} as const satisfies { readonly [key: string]: JsonResponse };

type Bindings = {
  BUCKET: R2Bucket;
  USERNAME: string;
  PASSWORD: string;
  API_KEY: string;
};

interface BodyParams extends BodyData {
  name: string;
  dir: string;
  file: File;
}

const app = new Hono<{ Bindings: Bindings }>();

const authException = (ctx: Context<{ Bindings: Bindings }>) => {
  const apiKey = ctx.req.headers.get("X-API-KEY");
  if (apiKey !== ctx.env.API_KEY)
    throw new HTTPException(STATUS_MESSAGES.unauthorized.status, {
      message: STATUS_MESSAGES.unauthorized.message,
    });
};

app.get("/", (ctx) => ctx.text("Hello Hono!"));

app
  .put("/upload", async (ctx) => {
    authException(ctx);

    const body = (await ctx.req.parseBody()) as BodyParams;
    const ext = body.file.name.split(".").at(-1);
    const filename = `${body.dir}/${body.name}.${ext}`;
    const blob = await body.file.arrayBuffer();

    const object = await ctx.env.BUCKET.get(filename);
    if (object)
      throw new HTTPException(STATUS_MESSAGES.conflict.status, {
        message: STATUS_MESSAGES.conflict.message,
      });

    try {
      await ctx.env.BUCKET.put(filename, blob);
    } catch (error) {
      console.log(error);
      throw new HTTPException(STATUS_MESSAGES.failed_file_save.status, {
        message: STATUS_MESSAGES.failed_file_save.message,
      });
    }

    return ctx.json<JsonResponse>({
      status: STATUS_MESSAGES.created.status,
      message: STATUS_MESSAGES.created.message,
    });
  })
  .all(() => {
    throw new HTTPException(STATUS_MESSAGES.method_not_allowed.status, {
      message: STATUS_MESSAGES.method_not_allowed.message,
    });
  });

app.get("/:path{.+$}", async (ctx) => {
  const { path } = ctx.req.param();

  const object = await ctx.env.BUCKET.get(path);
  if (!object)
    throw new HTTPException(STATUS_MESSAGES.not_found.status, {
      message: STATUS_MESSAGES.not_found.message,
    });

  const data = await object.arrayBuffer();
  return ctx.body(data);
});

app.onError((err, ctx) => {
  if (err instanceof HTTPException) {
    return ctx.json(
      {
        status: err.status,
        message: err.message,
      },
      err.status,
    );
  }

  return ctx.json(
    {
      status: STATUS_MESSAGES.internal_server_error.status,
      message: STATUS_MESSAGES.internal_server_error.message,
    },
    STATUS_MESSAGES.internal_server_error.status,
  );
});

export default app;
