# Third-party material in the pointer bank

## Pragmatic Segmenter: the Golden Rules

The `golden` family of the pointer bank (`packages/validators/src/ladders/pointer/kit/golden-rules.ts` and `bank/specs/golden.ts`) uses the Golden Rules of the Pragmatic Segmenter by Kevin S. Dias, https://github.com/diasks2/pragmatic_segmenter. The README section "The Golden Rules" lists edge cases of sentence segmentation, each with an input and its expected sentences. The bank keeps 53 of them, with their README numbers, titles and expected sentences verbatim. `bank/specs/golden.ts` lists every rule left out and why. The Pragmatic Segmenter is released under the MIT License:

    The MIT License (MIT)

    Copyright (c) 2015 Kevin S. Dias

    Permission is hereby granted, free of charge, to any person obtaining a copy
    of this software and associated documentation files (the "Software"), to deal
    in the Software without restriction, including without limitation the rights
    to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
    copies of the Software, and to permit persons to whom the Software is
    furnished to do so, subject to the following conditions:

    The above copyright notice and this permission notice shall be included in
    all copies or substantial portions of the Software.

    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
    IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
    FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
    AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
    LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
    OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
