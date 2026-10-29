#import <AppKit/AppKit.h>
#import <StoreKit/StoreKit.h>

typedef void (*TiaoReply)(void *, const char *);
extern void tiao_store_transactions(const char *);
static void Reply(TiaoReply callback, void *context, id result, NSString *error) {
    NSDictionary *envelope = error ? @{ @"error": error } : @{ @"result": result ?: [NSNull null] };
    NSData *data = [NSJSONSerialization dataWithJSONObject:envelope options:0 error:nil];
    NSString *text = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
    callback(context, text.UTF8String);
}
static NSMutableSet *requests;
@interface TiaoProducts : NSObject <SKProductsRequestDelegate>
@property(strong) SKProductsRequest *request;
@property(copy) NSString *account;
@property TiaoReply callback;
@property void *context;
@end
@implementation TiaoProducts
- (void)productsRequest:(SKProductsRequest *)request didReceiveResponse:(SKProductsResponse *)response {
    if (self.account) {
        SKProduct *product = response.products.firstObject;
        if (product) {
            SKMutablePayment *payment = [SKMutablePayment paymentWithProduct:product];
            payment.quantity = 1;
            payment.applicationUsername = self.account;
            [[SKPaymentQueue defaultQueue] addPayment:payment];
        }
        Reply(self.callback, self.context, @{ @"ok": @(product != nil), @"reason": product ? @"" : @"invalid_product" }, nil);
    } else {
        NSMutableArray *products = [NSMutableArray array];
        for (SKProduct *product in response.products) {
            NSNumberFormatter *format = [NSNumberFormatter new];
            format.numberStyle = NSNumberFormatterCurrencyStyle;
            format.locale = product.priceLocale;
            [products addObject:@{ @"productId": product.productIdentifier,
              @"title": product.localizedTitle ?: @"", @"description": product.localizedDescription ?: @"",
              @"price": product.price, @"formattedPrice": [format stringFromNumber:product.price] ?: @"",
              @"currencyCode": [product.priceLocale objectForKey:NSLocaleCurrencyCode] ?: @"" }];
        }
        Reply(self.callback, self.context, products, nil);
    }
    [requests removeObject:self];
}
- (void)request:(SKRequest *)request didFailWithError:(NSError *)error {
    Reply(self.callback, self.context, nil, error.localizedDescription);
    [requests removeObject:self];
}
@end
static NSMutableDictionary<NSString *, SKPaymentTransaction *> *pending;
static NSDictionary *Transaction(SKPaymentTransaction *tx) {
    NSArray *states = @[@"purchasing", @"purchased", @"failed", @"restored", @"deferred"];
    return @{ @"transactionId": tx.transactionIdentifier ?: @"",
      @"originalTransactionId": tx.originalTransaction.transactionIdentifier ?: [NSNull null],
      @"productId": tx.payment.productIdentifier ?: @"", @"state": states[tx.transactionState],
      @"transactionDate": tx.transactionDate ? @([tx.transactionDate timeIntervalSince1970]).stringValue : [NSNull null],
      @"errorCode": tx.error ? @(tx.error.code) : [NSNull null],
      @"errorMessage": tx.error.localizedDescription ?: [NSNull null] };
}
@interface TiaoStore : NSObject <SKPaymentTransactionObserver>
@end
@implementation TiaoStore
- (void)paymentQueue:(SKPaymentQueue *)queue updatedTransactions:(NSArray<SKPaymentTransaction *> *)transactions {
    NSMutableArray *updates = [NSMutableArray array];
    for (SKPaymentTransaction *tx in transactions) {
        [updates addObject:Transaction(tx)];
        if ((tx.transactionState == SKPaymentTransactionStatePurchased || tx.transactionState == SKPaymentTransactionStateRestored) && tx.transactionIdentifier) pending[tx.transactionIdentifier] = tx;
        else if (tx.transactionState == SKPaymentTransactionStateFailed) [queue finishTransaction:tx];
    }
    NSData *data = [NSJSONSerialization dataWithJSONObject:updates options:0 error:nil];
    NSString *text = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
    tiao_store_transactions(text.UTF8String);
}
- (void)paymentQueue:(SKPaymentQueue *)queue restoreCompletedTransactionsFailedWithError:(NSError *)error {
    NSData *data = [NSJSONSerialization dataWithJSONObject:@[@{@"state":@"failed",@"transactionId":@"",@"productId":@"",@"errorMessage":error.localizedDescription}] options:0 error:nil];
    tiao_store_transactions([[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding].UTF8String);
}
@end
static TiaoStore *observer;
void tiao_store_install(void) {
    if (observer) return;
    requests = [NSMutableSet new]; pending = [NSMutableDictionary new]; observer = [TiaoStore new];
    [[SKPaymentQueue defaultQueue] addTransactionObserver:observer];
}
void tiao_store_call(const char *json, void *context, TiaoReply callback) {
    NSData *data = [[NSString stringWithUTF8String:json] dataUsingEncoding:NSUTF8StringEncoding];
    NSDictionary *input = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
    dispatch_async(dispatch_get_main_queue(), ^{
        NSString *method = input[@"channel"]; NSArray *args = input[@"args"];
        if ([method isEqualToString:@"iap:isAvailable"]) {Reply(callback,context,@([SKPaymentQueue canMakePayments]),nil);return;}
        if ([method isEqualToString:@"iap:getPendingTransactions"]) {NSMutableArray *list=[NSMutableArray new];for (SKPaymentTransaction *tx in pending.allValues) [list addObject:Transaction(tx)];Reply(callback,context,list,nil);return;}
        if ([method isEqualToString:@"iap:restore"]) {[[SKPaymentQueue defaultQueue] restoreCompletedTransactions];Reply(callback,context,nil,nil);return;}
        if ([method isEqualToString:@"iap:finishTransaction"]) {SKPaymentTransaction *tx=pending[args[0]];if(tx){[[SKPaymentQueue defaultQueue] finishTransaction:tx];[pending removeObjectForKey:args[0]];}Reply(callback,context,@(tx!=nil),nil);return;}
        BOOL purchase = [method isEqualToString:@"iap:purchase"];
        if (purchase && ![SKPaymentQueue canMakePayments]) {Reply(callback,context,@{@"ok":@NO,@"reason":@"payments_disabled"},nil);return;}
        TiaoProducts *delegate=[TiaoProducts new];delegate.callback=callback;delegate.context=context;
        if (purchase) delegate.account=args[1];
        delegate.request=[[SKProductsRequest alloc] initWithProductIdentifiers:[NSSet setWithArray:purchase ? @[args[0]] : args[0]]];
        delegate.request.delegate=delegate;[requests addObject:delegate];[delegate.request start];
    });
}
