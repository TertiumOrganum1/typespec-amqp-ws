import "typespec-amqp-ws";

using TspAsyncApi;
using TspAsyncApi.Amqp;

@service(#{ title: "Notifications Producer" })
@info(#{ version: "1.0.0" })
@server("rabbit", #{ host: "localhost:5672", protocol: "amqp" })
namespace NotificationsProducer;

@doc("Уведомление пользователю")
model Notification {
  @doc("Уникальный идентификатор уведомления")
  notificationId: string;

  @doc("Текст уведомления")
  text: string;
}

@publish(#{
  routingKey: "notifications.created",
  exchange: #{ name: "notifications-exchange", type: "direct", durable: true },
})
@summary("Опубликовать новое уведомление")
op sendNotification(): Notification;
