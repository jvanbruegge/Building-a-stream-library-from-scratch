import i18next from 'i18next';

interface Observer<T> {
    next(data: T): void;
    error?(e: any): void;
    complete?(): void;
}

type Subscription = () => void;
type Stream<T> = (observer: Observer<T>) => Subscription;

function periodic(millis: number): Stream<number> {
    return observer => {
        let i = 0;
        const id = setInterval(() => {
            observer.next(i++);
        }, millis);

        return () => {
            clearInterval(id);
            observer.complete?.();
        };
    }
}

function subscribe<T>(obs: Observer<T>): (source: Stream<T>) => Subscription {
    return source => source(obs);
}

type Operator<T, U> = (source: Stream<T>) => Stream<U>;

function map<T, U>(f: (x: T) => U): Operator<T, U> {
    return source => observer => {
        return source({
            ...observer,
            next(data: T) {
                observer.next(f(data));
            }
        });
    };
}

function scan<T, U>(f: (acc: U, current: T) => U, initialValue: U): Operator<T, U> {
    return source => observer => {
        let current = initialValue;
        observer.next(current);
        return source({
            ...observer,
            next(data: T) {
                current = f(current, data);
                observer.next(current);
            }
        });
    };
}

function take<T>(n: number): Operator<T, T> {
    return source => observer => {
        let i = 0;
        const unsubscribe = source({
            ...observer,
            next(data: T) {
                observer.next(data);
                i++;
                if(i === n) {
                    unsubscribe();
                }
            }
        });

        return unsubscribe;
    };
}

function merge<T>(...streams: Stream<T>[]): Stream<T> {
    return observer => {
        let unsubscribes = Array(streams.length);
        let numCompleted = 0;

        for(let i = 0; i < streams.length; i++) {
            unsubscribes[i] = streams[i]({
                ...observer,
                complete() {
                    numCompleted++;
                    if(numCompleted === streams.length) {
                        observer.complete?.();
                    }
                }
            });
        }

        return () => {
            for(const unsub of unsubscribes) {
                unsub();
            }
        };
    };
}

function fromEvent(eventType: string, element: Element): Stream<Event> {
    return observer => {

        const listener = (ev: Event) => {
            observer.next(ev);
        };
        element.addEventListener(eventType, listener);

        return () => {
            element.removeEventListener(eventType, listener);
            observer.complete?.();
        };
    };
}

function fromPromise<T>(promise: Promise<T>): Stream<T> {
    return observer => {
        promise.then(data => {
            observer.next(data);
            observer.complete?.();
        }).catch(err => {
            observer.error?.(err);
        });

        return () => {};
    };
}

function startWith<T>(data: T): Operator<T, T> {
    return source => observer => {
        observer.next(data);
        return source(observer);
    };
}

function flatten<T>(outer: Stream<Stream<T>>): Stream<T> {
    return observer => {
        let innerSub: Subscription | undefined;
        let outerCompleted = false;

        const unsubscribe = outer({
            next(stream: Stream<T>) {
                innerSub?.();

                innerSub = stream({
                    next(data: T) {
                        observer.next(data);
                    },
                    error: observer.error,
                    complete() {
                        innerSub = undefined;
                        if(outerCompleted) {
                            observer.complete?.();
                        }
                    }
                });
            },
            error: observer.error,
            complete() {
                outerCompleted = true;
            }
        });

        return () => {
            unsubscribe();
            innerSub?.();
        };
    };
}

const finnish = {
    currentValue: 'Tällä hetkellä arvo on: {{value}}'
};
const german = {
    currentValue: 'Der aktuelle Wert ist: {{value}}'
}

const http = {
    get(url: string): Stream<any> {
        const lang = /\/translations\/(?<lang>\w+)/.exec(url)!.groups!.lang;

        return observer => {
            console.log(`Download of translation for ${lang} started`);
            const id = setTimeout(() => {
                if(lang === 'de') {
                    observer.next(german);
                } else if (lang === 'fi') {
                    observer.next(finnish);
                }
                observer.complete?.();
                console.log(`Download of translation for ${lang} completed`);
            }, 2000);

            return () => {
                console.log(`aborting request for '${lang}'`);
                clearTimeout(id);
            }
        };
    }
}

const language$ = pipe(
    fromPromise(i18next.init({
        resources: {
            en: {
                translation: {
                    currentValue: 'The current value is: {{value}}'
                }
            }
        }
    })),
    // map(() => fromEvent('change', document.querySelector('#language')!)),
    map(() => fromEvent('change', document.querySelector('#lang')!)),
    flatten,
    map(ev => (ev.currentTarget as HTMLSelectElement).value),
    startWith('en'),
    map(lang => {
        if(i18next.hasResourceBundle(lang, 'translation')) {
            return fromPromise(i18next.changeLanguage(lang));
        } else {
            return pipe(
                http.get(`/translations/${lang}`),
                map(res => {
                    const promise = i18next.addResourceBundle(lang, 'translation', res)
                        .changeLanguage(lang);
                    return fromPromise(promise);
                }),
                flatten
            );
        }
    }),
    flatten
);

const increment$ = pipe(
    fromEvent('click', document.querySelector('#increment')!),
    map(() => 1)
);

const decrement$ = pipe(
    fromEvent('click', document.querySelector('#decrement')!),
    map(() => -1)
);

const value$ = pipe(
    merge(increment$, decrement$),
    scan((sum, x) => sum + x, 0)
);

pipe(
    combine(value$, language$),
    subscribe({
        next([x, translate]) {
            document.querySelector('h2')!.textContent =
                translate('currentValue', { value: x });
        }
    })
);

function combine<A, B>(stream1: Stream<A>, stream2: Stream<B>): Stream<[A, B]>;
function combine<A, B, C>(stream1: Stream<A>, stream2: Stream<B>, stream3: Stream<C>): Stream<[A, B, C]>;
function combine<A, B, C, D>(stream1: Stream<A>, stream2: Stream<B>, stream3: Stream<C>, stream4: Stream<D>): Stream<[A, B, C, D]>;
function combine<A, B, C, D, E>(stream1: Stream<A>, stream2: Stream<B>, stream3: Stream<C>, stream4: Stream<D>, stream5: Stream<E>): Stream<[A, B, C, D, E]>;
function combine<A, B, C, D, E, F>(stream1: Stream<A>, stream2: Stream<B>, stream3: Stream<C>, stream4: Stream<D>, stream5: Stream<E>, stream6: Stream<F>): Stream<[A, B, C, D, E, F]>;
function combine<A, B, C, D, E, F, G>(stream1: Stream<A>, stream2: Stream<B>, stream3: Stream<C>, stream4: Stream<D>, stream5: Stream<E>, stream6: Stream<F>, stream7: Stream<G>): Stream<[A, B, C, D, E, F, G]>;
function combine<A, B, C, D, E, F, G, H>(stream1: Stream<A>, stream2: Stream<B>, stream3: Stream<C>, stream4: Stream<D>, stream5: Stream<E>, stream6: Stream<F>, stream7: Stream<G>, stream8: Stream<H>): Stream<[A, B, C, D, E, F, G, H]>;
function combine<A, B, C, D, E, F, G, H, I>(stream1: Stream<A>, stream2: Stream<B>, stream3: Stream<C>, stream4: Stream<D>, stream5: Stream<E>, stream6: Stream<F>, stream7: Stream<G>, stream8: Stream<H>, stream9: Stream<I>): Stream<[A, B, C, D, E, F, G, H, I]>;
function combine<A, B, C, D, E, F, G, H, I, J>(stream1: Stream<A>, stream2: Stream<B>, stream3: Stream<C>, stream4: Stream<D>, stream5: Stream<E>, stream6: Stream<F>, stream7: Stream<G>, stream8: Stream<H>, stream9: Stream<I>, stream10: Stream<J>): Stream<[A, B, C, D, E, F, G, H, I, J]>;
function combine<A, B, C, D, E, F, G, H, I, J, K>(stream1: Stream<A>, stream2: Stream<B>, stream3: Stream<C>, stream4: Stream<D>, stream5: Stream<E>, stream6: Stream<F>, stream7: Stream<G>, stream8: Stream<H>, stream9: Stream<I>, stream10: Stream<J>, stream11: Stream<K>): Stream<[A, B, C, D, E, F, G, H, I, J, K]>;

function combine(...streams: Stream<any>[]): Stream<any[]> {
    return observer => {
        const marker = {};
        let values = Array(streams.length).fill(marker);
        let unsubscribes = Array(streams.length);
        let numData = 0;
        let numCompleted = 0;

        for(let i = 0; i < streams.length; i++) {
            unsubscribes[i] = streams[i]({
                next(data: any) {
                    if(values[i] === marker) {
                        numData++;
                    }
                    values[i] = data;
                    if(numData === streams.length) {
                        observer.next(values);
                    }
                },
                error: observer.error,
                complete() {
                    numCompleted++;
                    if(numCompleted === streams.length) {
                        observer.complete?.();
                    }
                }
            });
        }

        return () => {
            for(const unsub of unsubscribes) {
                unsub();
            }
        };
    };
}

function pipe<A, B>(arg: A, fn0: (arg: A) => B): B;
function pipe<A, B, C>(arg: A, fn0: (arg: A) => B, fn1: (arg: B) => C): C;
function pipe<A, B, C, D>(arg: A, fn0: (arg: A) => B, fn1: (arg: B) => C, fn2: (arg: C) => D): D;
function pipe<A, B, C, D, E>(arg: A, fn0: (arg: A) => B, fn1: (arg: B) => C, fn2: (arg: C) => D, fn3: (arg: D) => E): E;
function pipe<A, B, C, D, E, F>(arg: A, fn0: (arg: A) => B, fn1: (arg: B) => C, fn2: (arg: C) => D, fn3: (arg: D) => E, fn4: (arg: E) => F): F;
function pipe<A, B, C, D, E, F, G>(arg: A, fn0: (arg: A) => B, fn1: (arg: B) => C, fn2: (arg: C) => D, fn3: (arg: D) => E, fn4: (arg: E) => F, fn5: (arg: F) => G): G;
function pipe<A, B, C, D, E, F, G, H>(arg: A, fn0: (arg: A) => B, fn1: (arg: B) => C, fn2: (arg: C) => D, fn3: (arg: D) => E, fn4: (arg: E) => F, fn5: (arg: F) => G, fn6: (arg: G) => H): H;
function pipe<A, B, C, D, E, F, G, H, I>(arg: A, fn0: (arg: A) => B, fn1: (arg: B) => C, fn2: (arg: C) => D, fn3: (arg: D) => E, fn4: (arg: E) => F, fn5: (arg: F) => G, fn6: (arg: G) => H, fn7: (arg: H) => I): I;
function pipe<A, B, C, D, E, F, G, H, I, J>(arg: A, fn0: (arg: A) => B, fn1: (arg: B) => C, fn2: (arg: C) => D, fn3: (arg: D) => E, fn4: (arg: E) => F, fn5: (arg: F) => G, fn6: (arg: G) => H, fn7: (arg: H) => I, fn8: (arg: I) => J): J;
function pipe<A, B, C, D, E, F, G, H, I, J, K>(arg: A, fn0: (arg: A) => B, fn1: (arg: B) => C, fn2: (arg: C) => D, fn3: (arg: D) => E, fn4: (arg: E) => F, fn5: (arg: F) => G, fn6: (arg: G) => H, fn7: (arg: H) => I, fn8: (arg: I) => J, fn9: (arg: J) => K): K;

function pipe(arg: any, ...fns: ((arg: any) => any)[]): any {
    let current = arg;
    for (const f of fns) {
        current = f(current);
    }
    return current;
}
