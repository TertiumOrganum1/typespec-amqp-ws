import "typespec-amqp-ws";

using TspAsyncApi;
using TspAsyncApi.Amqp;

@service(#{ title: "Notifications Consumer" })
@info(#{ version: "1.0.0" })
@server("rabbit", #{ host: "localhost:5672", protocol: "amqp" })
namespace NotificationsConsumer;

@doc("Уведомление пользователю")
model Notification {
  notificationId: string;
  text: string;
}

@consume(#{
  routingKey: "notifications.created",
  queue: #{
    name: "notifications-consumer-queue",
    durable: true,
    autoDelete: false,
  },
})
@summary("Обработать уведомление из очереди")
op handleNotification(): Notification;
