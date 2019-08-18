export type Either<L, R> = Either.Left<L> | Either.Right<R>;

export namespace Either {
    export interface Left<L> {
        type: "Left";
        value: L;
    }

    export interface Right<R> {
        type: "Right";
        value: R;
    }
}
